import { useEffect } from "react";
import { create } from "zustand";
import {
  LOCAL_CHAT_PROVIDERS,
  chatTabId,
  type Chat,
  type ChatSave,
  type ChatContextMeta,
  type ChatTab,
  type ChatTabRef,
  type ChatDelivery,
  type ChatMessageMatch,
  type ChatTurn,
  type ChatTurnItem,
} from "@otter/contracts/chats";

import { ipc } from "~/lib/ipc";
import { EXTENSIONS } from "../extensions/registry";
import { closeChatPages } from "../browser/store";
import { isProviderUsable, useAgentProviders } from "./agent-providers";
import {
  DEFAULT_AGENT,
  mailApi,
  type ApprovalDecision,
  type ApprovalRequest,
  type ChatAttachment,
  type ChatChange,
  type ChatEvent,
  type ChatQuestion,
  type ChatSession,
  type ChatSessionMessage,
  type ProviderKind,
  type ProviderSnapshot,
  type Skill,
} from "../mail/api";
import type { SentAttachment } from "./chat-attachments";
import { mergeChatChanges } from "./chat-changes";
import { placeDelivered } from "./chat-order";
import type { Citation } from "./chat-cite";
import { isChatFileLink } from "./chat-links";
import type { FollowUpBehavior } from "./chat-queue";
import { toast } from "../mail/toast";

export type { ChatTab, ChatTurn };

export type Conversation = Chat & {
  /**
   * The turn in flight (its request id), kept on this device so one the app
   * quits during is picked up again on the next launch, where the provider's
   * runs outlive it.
   */
  openRequest?: string | null;
  loaded: boolean;
};

export type Run = { requestId: string; convoId: string; provider: ProviderKind };

export type Outgoing = {
  id: string;
  convoId: string;
  provider: ProviderKind;
  question: string;
  input: string;
  skill?: Skill;
  title: string;
  context?: ChatContextMeta;
  attachments?: ChatAttachment[];
  sent?: SentAttachment[];
  citations?: Citation[];
};

export type QueuedMessage = Outgoing;

type Device = { id: string; name: string };

type ChatsState = {
  conversations: Conversation[];
  ready: boolean;
  device: Device | null;
  activeId: string;
  activeTabs: Record<string, string>;
  watched: string | null;
  runs: Record<string, Run>;
  unseen: ReadonlySet<string>;
  approvals: { requestId: string; approval: ApprovalRequest }[];
  questions: { requestId: string; question: ChatQuestion }[];
  queue: QueuedMessage[];
  /** The queued message being edited in its chat's composer, and the draft it took the place of. */
  editingQueued: { id: string; convoId: string; savedDraft: string } | null;
  hydrating: string | null;
  drafts: Record<string, string>;
  citations: Record<string, Citation[]>;
  /** The message a chat search opened the chat on, until the next search. */
  found: { turnId: string; query: string } | null;
  /** Failed answers (by turn id) that sending their message again could fix. */
  retries: Record<string, Outgoing>;
};

const ACTIVE_KEY = "gmail:chat-active";
const ACTIVE_TABS_KEY = "gmail:chat-active-tabs";
const OPEN_REQUESTS_KEY = "gmail:chat-open-requests";
const DRAFTS_KEY = "gmail:chat-drafts";
/** New chats with a draft in them: they aren't saved anywhere else until their first message. */
const NEW_DRAFTS_KEY = "gmail:chat-new-drafts";
// Chats were kept here before they synced; they start over.
localStorage.removeItem("gmail:hermes-chat:v2");
localStorage.removeItem("gmail:panel-tabs");

function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function clampTitle(text: string): string {
  const t = text.trim();
  if (!t) return "New chat";
  return t.length > 56 ? `${t.slice(0, 56)}…` : t;
}

function newConversation(provider: ProviderKind = DEFAULT_AGENT): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    provider,
    sessionId: null,
    sessionOwned: false,
    lastResponseId: null,
    device: null,
    createdAt: now,
    updatedAt: now,
    returnedAt: now,
    tabs: [],
    turns: [],
    loaded: true,
  };
}

const isSteer = (t: ChatTurn) =>
  t.role === "user" && (t.intent === "steer" || t.intent === "promoted");

/**
 * The replies of the latest run: the last one, and those before it that a steer continued. What's
 * said in a call is no run's, and comes after the reply of a run going meanwhile.
 */
export function runReplyIds(turns: ChatTurn[]): Set<string> {
  const ids = new Set<string>();
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].spoken) {
      if (turns[i].role === "user" && ids.size > 0) break;
      continue;
    }
    if (turns[i].role === "assistant") ids.add(turns[i].id);
    else if (!isSteer(turns[i])) break;
  }
  return ids;
}

/** The run in flight is compacting its context: it can't take a steer until that's done. */
export function isCompacting(turns: ChatTurn[]): boolean {
  const run = runReplyIds(turns);
  return turns.some(
    (t) =>
      run.has(t.id) &&
      !t.finishedAt &&
      t.items?.some((i) => i.kind === "step" && i.step.compaction && i.output === undefined),
  );
}

const compactingIn = (convoId: string) =>
  isCompacting(get().conversations.find((c) => c.id === convoId)?.turns ?? []);

export const isBlank = (c: Conversation) => c.loaded && c.turns.length === 0;

export const hasDraft = (drafts: Record<string, string>, id: string) => Boolean(drafts[id]?.trim());

type NewDraft = Pick<Conversation, "id" | "provider" | "createdAt">;

function restoreNewDrafts(drafts: Record<string, string>): Conversation[] {
  return readJson<NewDraft[]>(NEW_DRAFTS_KEY, [])
    .filter((d) => hasDraft(drafts, d.id))
    .map((d) => ({ ...newConversation(d.provider), ...d, updatedAt: d.createdAt }));
}

export const isElsewhere = (c: Conversation, device: Device | null) =>
  LOCAL_CHAT_PROVIDERS.includes(c.provider) && c.device !== null && c.device.id !== device?.id;

/** Hydrated user turns show the question, not the context block sent with it. */
function stripHandoff(text: string): string {
  const cut = text.indexOf("\n\n— context from Otter Mail —");
  return cut === -1 ? text : text.slice(0, cut);
}

function turnsFromMessages(messages: ChatSessionMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let open: ChatTurn | null = null;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === "user") {
      open = null;
      turns.push({ id: `h-${i}`, role: "user", text: stripHandoff(m.text) });
    } else if (m.role === "assistant") {
      if (!open) {
        open = { id: `h-${i}`, role: "assistant", text: "", items: [] };
        turns.push(open);
      }
      if (m.text) open.items!.push({ kind: "text", text: m.text });
      // A compaction is in the session once it's done.
      for (const step of m.toolCalls ?? [])
        open.items!.push({ kind: "step", step, ...(step.compaction ? { output: "" } : {}) });
    } else if (m.role === "tool" && open) {
      const pending = open.items!.find((t) => t.kind === "step" && t.output === undefined);
      if (pending?.kind === "step") pending.output = m.text || "(done)";
    }
  }
  return turns.filter((t) => t.role === "user" || (t.items?.length ?? 0) > 0);
}

function withTranscript(
  turns: ChatTurn[],
  requestId: string,
  messages: ChatSessionMessage[],
): ChatTurn[] {
  // A run the agent started itself has no message of ours: its turn starts the run.
  const own = turns.findIndex((t) => t.id === `a-${requestId}`);
  let at = turns.findIndex((t) => t.id === `u-${requestId}`);
  if (at < 0) at = own >= 0 ? own - 1 : turns.findLastIndex((t) => t.role === "user");
  // What's said in a call meanwhile isn't in the run's record: it stays, after the run.
  const spoken = turns.slice(at + 1).filter((t) => t.spoken);
  const local = turns.slice(at + 1).filter((t) => !t.spoken);
  const recorded = turnsFromMessages(messages);
  const startedAt = local.find((t) => t.role === "assistant")?.startedAt;
  let next: ChatTurn[];
  if (recorded.length === local.length && recorded.every((t, i) => t.role === local[i].role)) {
    next = local.map((t, i) =>
      t.role === "assistant"
        ? { ...t, text: "", items: recorded[i].items, error: undefined, finishedAt: undefined }
        : t,
    );
  } else {
    // The turn keeps its id (a run of the agent's own is known by it).
    next = recorded.map((t, i) =>
      i === 0 && t.role === "assistant"
        ? { ...t, id: local[0]?.role === "assistant" ? local[0].id : t.id, startedAt }
        : t,
    );
  }
  if (next[next.length - 1]?.role !== "assistant")
    next.push({
      id: next.length === 0 ? `a-${requestId}` : `a-${requestId}-rest`,
      role: "assistant",
      text: "",
      items: [],
      startedAt,
    });
  return [...turns.slice(0, at + 1), ...next, ...spoken];
}

/** Errors sending the message again won't fix: they need Settings, or were asked for. */
const FINAL = new Set([
  "not_configured",
  "not_installed",
  "provider_disabled",
  "unauthorized",
  "cancelled",
  "pairing_required",
  "origin_not_allowed",
]);

/** What each run in flight was sent, so a failed one can be sent again. */
const sent = new Map<string, Outgoing>();

/**
 * A run picked up after a reload has nothing in `sent`: its message, read back from the chat,
 * unless it carried what only the original send had: attachments, mail context, quotes, a skill.
 */
function resendable(c: Conversation, requestId: string): Outgoing | null {
  const turn = c.turns.find((t) => t.id === `u-${requestId}`);
  if (
    !turn?.text.trim() ||
    turn.attachments?.length ||
    turn.context ||
    turn.citations?.length ||
    turn.skill
  )
    return null;
  return {
    id: crypto.randomUUID(),
    convoId: c.id,
    provider: c.provider,
    question: turn.text,
    input: turn.text,
    title: clampTitle(turn.text),
  };
}

function friendlyError(code: string, provider: ProviderKind): string {
  const name = EXTENSIONS.find((e) => e.manifest.id === provider)?.manifest.name ?? provider;
  switch (code) {
    case "not_configured":
      return `${name} isn't set up. Connect it in Settings → Agents.`;
    case "not_installed":
      return "The Codex CLI wasn't found. Check it in Settings → Agents.";
    case "provider_disabled":
      return `${name} is turned off in Settings → Agents.`;
    case "unauthorized":
      return provider === "openclaw"
        ? "The OpenClaw gateway refused this device. Reconnect it in Settings → OpenClaw."
        : "The API key was rejected. Update it in Settings.";
    case "unreachable":
      if (provider === "openclaw") return "Can't reach the OpenClaw gateway.";
      if (provider === "codex") return "Lost the connection to Codex.";
      return `Can't reach ${name}. Are you on Tailscale?`;
    case "timeout":
      return `${name} went quiet for too long, so the run was stopped.`;
    case "cancelled":
      return "Stopped.";
    case "pairing_required":
      return "Approve this device on the OpenClaw gateway. The command is in Settings → Agents.";
    case "origin_not_allowed":
      return "The OpenClaw gateway doesn't allow this site yet. See Settings → Agents.";
    case "session_not_found":
      return `This chat's ${name} session no longer exists. Send again to start a new one.`;
    case "not_received":
      return `${name} never got this message. Send it again.`;
    default:
      return code.startsWith("agent_error: ")
        ? code.slice("agent_error: ".length)
        : `${name} answered with an error (${code}).`;
  }
}

export const useChats = create<ChatsState>(() => ({
  conversations: restoreNewDrafts(readJson<Record<string, string>>(DRAFTS_KEY, {})),
  ready: false,
  device: null,
  activeId: localStorage.getItem(ACTIVE_KEY) ?? "",
  activeTabs: readJson<Record<string, string>>(ACTIVE_TABS_KEY, {}),
  watched: null,
  runs: {},
  unseen: new Set(),
  approvals: [],
  questions: [],
  queue: [],
  editingQueued: null,
  hydrating: null,
  drafts: readJson<Record<string, string>>(DRAFTS_KEY, {}),
  citations: {},
  found: null,
  retries: {},
}));

const { getState: get, setState: set } = useChats;

const chatsApi = {
  list: () => ipc<{ chats: Omit<Chat, "turns">[]; device: Device }>("chats:list"),
  get: (id: string) => ipc<Chat | null>("chats:get", { id }),
  search: (query: string) => ipc<ChatMessageMatch[]>("chats:search", { query }),
  save: (save: ChatSave) => ipc<void>("chats:save", save),
  delete: (id: string) => ipc<void>("chats:delete", { id }),
};

export const searchChatMessages = chatsApi.search;

export const showFoundMessage = (found: ChatsState["found"]) => set({ found });

/** The turns in flight when the app last quit, read before anything writes the key again. */
const savedOpenRequests = readJson<Record<string, string>>(OPEN_REQUESTS_KEY, {});
/** Chats core has listed: one gone from its list was deleted, one never in it is new here. */
const coreIds = new Set<string>();

const fromCore = new WeakSet<Conversation>();
/** Turns as core has them, by chat (a fork shares its source's turns): a save sends the others. */
const stored = new WeakMap<ChatTurn, string>();
const asLoaded = (c: Conversation) => {
  fromCore.add(c);
  if (c.loaded) for (const turn of c.turns) stored.set(turn, c.id);
  return c;
};

const saving = new Set<string>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(id: string): void {
  if (saveTimers.has(id)) return;
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id);
      const convo = get().conversations.find((c) => c.id === id);
      if (!convo || !convo.loaded || convo.turns.length === 0) return;
      const { openRequest: _open, loaded: _loaded, turns, ...chat } = convo;
      const changed = turns.filter((turn) => stored.get(turn) !== id);
      saving.add(id);
      chatsApi
        .save({ chat, turnIds: turns.map((t) => t.id), turns: changed, settled: !get().runs[id] })
        .then(() => changed.forEach((turn) => stored.set(turn, id)))
        .catch((error: unknown) => console.log("[AgentChat:save] failed", { error: String(error) }))
        .finally(() => saving.delete(id));
    }, 1500),
  );
}

useChats.subscribe((state, prev) => {
  if (state.activeId !== prev.activeId) localStorage.setItem(ACTIVE_KEY, state.activeId);
  if (state.activeTabs !== prev.activeTabs)
    localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(state.activeTabs));
  if (state.drafts !== prev.drafts || state.conversations !== prev.conversations) saveDrafts();
  if (state.conversations === prev.conversations) return;
  const before = new Map(prev.conversations.map((c) => [c.id, c]));
  const open: Record<string, string> = {};
  for (const c of state.conversations) {
    if (c.openRequest) open[c.id] = c.openRequest;
    if (c === before.get(c.id) || fromCore.has(c) || !c.loaded || c.turns.length === 0) continue;
    scheduleSave(c.id);
  }
  localStorage.setItem(OPEN_REQUESTS_KEY, JSON.stringify(open));
});

let draftTimer: ReturnType<typeof setTimeout> | null = null;

function saveDrafts(): void {
  draftTimer ??= setTimeout(writeDrafts, 300);
}

function writeDrafts(): void {
  draftTimer = null;
  const { conversations, drafts } = get();
  const ids = new Set(conversations.map((c) => c.id));
  const kept = Object.fromEntries(
    Object.entries(drafts).filter(([id, text]) => text.trim() && ids.has(id)),
  );
  const fresh: NewDraft[] = conversations
    .filter((c) => isBlank(c) && kept[c.id])
    .map(({ id, provider, createdAt }) => ({ id, provider, createdAt }));
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(kept));
    localStorage.setItem(NEW_DRAFTS_KEY, JSON.stringify(fresh));
  } catch {
    // Without storage, drafts last until the app closes.
  }
}

// A refresh or quit inside the debounce would lose the last keystrokes.
window.addEventListener("pagehide", () => {
  if (draftTimer) {
    clearTimeout(draftTimer);
    writeDrafts();
  }
});

async function loadChats(): Promise<void> {
  const { chats, device } = await chatsApi.list();
  const known = new Set(coreIds);
  for (const chat of chats) coreIds.add(chat.id);
  set((s) => {
    const mine = new Map(s.conversations.map((c) => [c.id, c]));
    const listed = new Set(chats.map((c) => c.id));
    const conversations: Conversation[] = chats.map((chat) => {
      const local = mine.get(chat.id);
      if (local && (local.updatedAt >= chat.updatedAt || s.runs[chat.id])) return local;
      return asLoaded({
        ...chat,
        turns: local?.turns ?? [],
        loaded: false,
        openRequest: chat.sessionId
          ? (local?.openRequest ?? savedOpenRequests[chat.id] ?? null)
          : null,
      });
    });
    for (const c of s.conversations) {
      if (!listed.has(c.id) && (!known.has(c.id) || s.runs[c.id])) conversations.push(c);
    }
    const unseen = new Set([...s.unseen].filter((id) => conversations.some((c) => c.id === id)));
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    let activeId = s.activeId;
    if (!conversations.some((c) => c.id === activeId)) {
      const blank =
        conversations.find((c) => isBlank(c) && !hasDraft(s.drafts, c.id)) ?? newConversation();
      if (!conversations.includes(blank)) conversations.unshift(blank);
      activeId = blank.id;
    }
    return { conversations, device, ready: true, activeId, unseen };
  });
}

/** Loads under way: whoever asks while one is going waits for it, so nothing is added to a chat it then replaces. */
const loading = new Map<string, Promise<void>>();

export function loadChat(id: string): Promise<void> {
  let load = loading.get(id);
  if (!load) {
    load = readChat(id).finally(() => loading.delete(id));
    loading.set(id, load);
  }
  return load;
}

async function readChat(id: string): Promise<void> {
  const chat = await chatsApi.get(id);
  if (!chat) return;
  set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === id && !c.loaded
        ? asLoaded({ ...chat, loaded: true, openRequest: c.openRequest })
        : c,
    ),
  }));
}

function patchConversation(id: string, fn: (c: Conversation) => Conversation): void {
  set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)) }));
}

function endRun(requestId: string): void {
  const entry = Object.values(get().runs).find((r) => r.requestId === requestId);
  sent.delete(requestId);
  if (!entry) return;
  set((s) => {
    const runs = { ...s.runs };
    delete runs[entry.convoId];
    return { runs };
  });
  startQueued();
  const waiting = waitingRuns.get(entry.convoId);
  waitingRuns.delete(entry.convoId);
  for (const run of waiting ?? []) void followAgentRun(run);
}

/**
 * A chat's queued message starts once no turn is running in it (after
 * completion, an error, or Stop) — never at a tool boundary; that's what
 * Steer is for. Each chat drains its own queue.
 */
function startQueued(): void {
  for (;;) {
    const { queue, runs, editingQueued } = get();
    const next = queue.find((m) => !runs[m.convoId] && m.id !== editingQueued?.id);
    if (!next) return;
    set({ queue: queue.filter((m) => m.id !== next.id) });
    startTurn(next);
  }
}

function appendExchange(
  convoId: string,
  msg: Outgoing,
  requestKey: string,
  intent?: ChatTurn["intent"],
): void {
  const steered = intent === "steer" || intent === "promoted";
  patchConversation(convoId, (c) => ({
    ...c,
    updatedAt: Date.now(),
    returnedAt: Date.now(),
    snoozedUntil: null,
    settledAt: null,
    turns: [
      // A steer joins the run in flight: the reply before it goes on until the run ends.
      ...c.turns.map((t, i) =>
        !steered && i === c.turns.length - 1 && t.role === "assistant" && !t.finishedAt
          ? { ...t, finishedAt: Date.now() }
          : t,
      ),
      {
        id: `u-${requestKey}`,
        role: "user",
        text: msg.question,
        skill: msg.skill?.name,
        context: msg.context,
        attachments: msg.sent,
        citations: msg.citations?.map(({ text, comment }) => ({ text, comment })),
        intent,
        startedAt: Date.now(),
      },
      {
        id: `a-${requestKey}`,
        role: "assistant",
        text: "",
        items: [],
        startedAt: Date.now(),
      },
    ],
  }));
  for (const { title, target } of msg.context?.items ?? []) {
    if (target.kind === "thread")
      openChatTab(convoId, { kind: "thread", accountId: target.accountId, id: target.id }, title, {
        show: false,
      });
  }
}

function startTurn(msg: Outgoing, intent?: ChatTurn["intent"]): void {
  const convo = get().conversations.find((c) => c.id === msg.convoId);
  if (!convo) return;
  const requestId = crypto.randomUUID();
  const firstTurn = convo.turns.length === 0;
  const kind = firstTurn ? msg.provider : convo.provider;
  console.log("[AgentChat:send]", {
    requestId,
    provider: kind,
    attached: Boolean(msg.context),
    skill: msg.skill?.name,
    session: convo.sessionId ?? "new",
  });
  sent.set(requestId, msg);
  set((s) => ({
    runs: { ...s.runs, [msg.convoId]: { requestId, convoId: msg.convoId, provider: kind } },
    retries: Object.fromEntries(
      Object.entries(s.retries).filter(([, m]) => m.convoId !== msg.convoId),
    ),
  }));
  patchConversation(msg.convoId, (c) => ({
    ...c,
    provider: firstTurn ? kind : c.provider,
    title: firstTurn ? msg.title : c.title,
    device:
      firstTurn && LOCAL_CHAT_PROVIDERS.includes(kind) ? get().device : firstTurn ? null : c.device,
    openRequest: requestId,
  }));
  appendExchange(msg.convoId, msg, requestId, intent);
  mailApi
    .agentSend({
      provider: kind,
      requestId,
      input: msg.input,
      sessionId: convo.sessionId ?? undefined,
      title: firstTurn ? msg.title : undefined,
      skill: msg.skill ? { name: msg.skill.name, path: msg.skill.path } : undefined,
      attachments: msg.attachments,
      previousResponseId: convo.sessionId ? undefined : (convo.lastResponseId ?? undefined),
    })
    .catch((error: unknown) => {
      console.log("[AgentChat:send] failed", { error: String(error) });
      patchConversation(msg.convoId, (c) => ({
        ...c,
        turns: c.turns.map((t) =>
          t.id === `a-${requestId}`
            ? { ...t, error: friendlyError("unreachable", kind), finishedAt: Date.now() }
            : t,
        ),
        openRequest: null,
      }));
      set((s) => ({ retries: { ...s.retries, [`a-${requestId}`]: msg } }));
      endRun(requestId);
    });
}

function steer(msg: Outgoing, intent: "steer" | "promoted" = "steer"): void {
  const target = get().runs[msg.convoId];
  if (!target) return startTurn(msg);
  console.log("[AgentChat:steer]", { provider: target.provider, intent });
  const key = `${target.requestId}-${msg.id}`;
  appendExchange(msg.convoId, msg, key, intent);
  const refused = () => {
    patchConversation(msg.convoId, (c) => ({
      ...c,
      turns: c.turns.filter((t) => t.id !== `u-${key}` && t.id !== `a-${key}`),
    }));
    set((s) => ({ queue: [msg, ...s.queue] }));
    startQueued();
  };
  mailApi
    .agentSteer(target.provider, target.requestId, msg.input)
    .then(({ accepted }) => !accepted && refused(), refused);
}

export function sendMessage(msg: Outgoing, followUp: FollowUpBehavior): void {
  if (!get().runs[msg.convoId]) return startTurn(msg);
  // As in T3 Code, a message waits in the queue while the run compacts.
  if (followUp === "queue" || msg.attachments || compactingIn(msg.convoId))
    set((s) => ({ queue: [...s.queue, msg] }));
  else steer(msg);
}

/** Sends a failed message again, in place of the failed exchange. */
export function retryTurn(turnId: string): void {
  const msg = get().retries[turnId];
  if (!msg || get().runs[msg.convoId]) return;
  const requestKey = turnId.slice("a-".length);
  patchConversation(msg.convoId, (c) => ({
    ...c,
    turns: c.turns.filter((t) => t.id !== turnId && t.id !== `u-${requestKey}`),
  }));
  startTurn(msg);
}

export function steerQueued(id: string): void {
  const msg = get().queue.find((m) => m.id === id);
  if (!msg || !get().runs[msg.convoId] || compactingIn(msg.convoId)) return;
  if (get().editingQueued?.id === id) cancelQueuedEdit();
  set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
  steer(msg, "promoted");
}

export function removeQueued(id: string): void {
  if (get().editingQueued?.id === id) cancelQueuedEdit();
  set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
}

export function updateQueued(id: string, text: string): void {
  set((s) => ({
    queue: s.queue.map((m) =>
      m.id === id
        ? {
            ...m,
            question: text,
            input:
              m.input === m.question
                ? text
                : m.question
                  ? m.input.replace(m.question, text)
                  : `${text}\n\n${m.input}`,
            title: clampTitle(text),
          }
        : m,
    ),
  }));
}

/** Moves a queued message into its chat's composer; it stays queued, held, until saved or cancelled. */
export function editQueued(id: string): void {
  const msg = get().queue.find((m) => m.id === id);
  if (!msg) return;
  const { editingQueued, drafts } = get();
  const savedDraft =
    editingQueued?.convoId === msg.convoId ? editingQueued.savedDraft : (drafts[msg.convoId] ?? "");
  set({ editingQueued: { id, convoId: msg.convoId, savedDraft } });
  setDraft(msg.convoId, msg.question);
}

/** Gives the composer its draft back; `convoId` limits it to that chat's edit. */
export function cancelQueuedEdit(convoId?: string): void {
  const editing = get().editingQueued;
  if (!editing || (convoId && editing.convoId !== convoId)) return;
  set({ editingQueued: null });
  setDraft(editing.convoId, editing.savedDraft);
  startQueued();
}

export function stopRun(convoId: string): void {
  const run = get().runs[convoId];
  if (run) void mailApi.agentCancel(run.provider, run.requestId);
}

export async function respondApproval(
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  const { approvals, runs } = get();
  const pending = approvals.find((a) => a.approval.id === approvalId);
  const owner = pending && Object.values(runs).find((r) => r.requestId === pending.requestId);
  if (!owner) return;
  const { provider: kind, requestId } = owner;
  console.log("[AgentChat:approval]", { kind, decision });
  try {
    await mailApi.agentRespondApproval({ provider: kind, requestId, approvalId, decision });
    set((s) => ({ approvals: s.approvals.filter((a) => a.approval.id !== approvalId) }));
  } catch (error) {
    console.log("[AgentChat:approval] failed", { error: String(error) });
  }
}

export async function answerQuestion(
  questionId: string,
  answers: Record<string, string[]> | null,
): Promise<void> {
  const { questions, runs } = get();
  const pending = questions.find((q) => q.question.id === questionId);
  const owner = pending && Object.values(runs).find((r) => r.requestId === pending.requestId);
  if (!owner) return;
  console.log("[AgentChat:question]", { kind: owner.provider, skipped: answers === null });
  try {
    await mailApi.agentAnswerQuestion({
      provider: owner.provider,
      requestId: owner.requestId,
      questionId,
      answers,
    });
    set((s) => ({ questions: s.questions.filter((q) => q.question.id !== questionId) }));
  } catch (error) {
    console.log("[AgentChat:question] failed", { error: String(error) });
    toast.error("Couldn't send the answer", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A tab open in the chat's panel; a closed one is still in the chat's context. */
export const isOpenTab = (tab: ChatTab) => !tab.closedAt;

/**
 * Opens a tab in the chat's panel, or brings back one closed there. What the agent opens on its
 * own (`show: false`) leaves a tab you closed closed.
 */
export function openChatTab(
  convoId: string,
  ref: ChatTabRef,
  title: string,
  {
    show = true,
    made,
    id = chatTabId(ref),
  }: {
    show?: boolean;
    made?: boolean;
    /** A tab of its own, not the one showing `ref`. */
    id?: string;
  } = {},
): void {
  set((s) => {
    const convo = s.conversations.find((c) => c.id === convoId);
    if (!convo) return s;
    const existing = convo.tabs.find((t) => t.id === id);
    if (existing?.closedAt && !show) return s;
    const tabs = existing
      ? existing.closedAt || (made && !existing.made)
        ? convo.tabs.map((t) =>
            t === existing ? { ...t, closedAt: null, ...(made && { made: true }) } : t,
          )
        : convo.tabs
      : [
          ...convo.tabs,
          { id, title: clampTitle(title), ref, addedAt: Date.now(), ...(made && { made: true }) },
        ];
    const conversations =
      tabs === convo.tabs
        ? s.conversations
        : s.conversations.map((c) => (c === convo ? { ...c, tabs, updatedAt: Date.now() } : c));
    const activeTabs =
      show || !s.activeTabs[convoId] ? { ...s.activeTabs, [convoId]: id } : s.activeTabs;
    return { conversations, activeTabs };
  });
}

export function showChatTab(convoId: string, tabId: string): void {
  set((s) => ({ activeTabs: { ...s.activeTabs, [convoId]: tabId } }));
}

export function closeChatTab(convoId: string, tabId: string): void {
  set((s) => {
    const convo = s.conversations.find((c) => c.id === convoId);
    const open = convo?.tabs.filter(isOpenTab) ?? [];
    const at = open.findIndex((t) => t.id === tabId);
    if (!convo || at < 0) return s;
    const rest = open.filter((t) => t.id !== tabId);
    const shown = s.activeTabs[convoId];
    const activeTabs = { ...s.activeTabs };
    if (shown === tabId || !shown) {
      const next = rest[at - 1] ?? rest[at];
      if (next) activeTabs[convoId] = next.id;
      else delete activeTabs[convoId];
    }
    const tabs = convo.tabs.map((t) => (t.id === tabId ? { ...t, closedAt: Date.now() } : t));
    return {
      conversations: s.conversations.map((c) =>
        c === convo ? { ...c, tabs, updatedAt: Date.now() } : c,
      ),
      activeTabs,
    };
  });
}

export function reorderChatTabs(convoId: string, order: string[]): void {
  patchConversation(convoId, (c) => ({
    ...c,
    tabs: [
      ...order.flatMap((id) => c.tabs.filter((t) => t.id === id)),
      ...c.tabs.filter((t) => !order.includes(t.id)),
    ],
    updatedAt: Date.now(),
  }));
}

const hostOf = (url: string) => URL.parse(url)?.host.replace(/^www\./, "") ?? url;
const basename = (path: string) => path.split(/[\\/]/).pop() || path;

function changeTab(change: ChatChange): { ref: ChatTabRef; title: string; made: boolean } | null {
  const { target } = change;
  if (target.kind === "thread" || target.kind === "draft")
    return {
      ref: { kind: target.kind, accountId: target.accountId, id: target.id },
      title: change.title,
      made: target.kind === "draft",
    };
  if (target.kind === "event" && target.url && change.action !== "deleted")
    return { ref: { kind: "page", url: target.url }, title: change.title, made: true };
  return null;
}

function linkedFiles(text: string): { title: string; href: string }[] {
  return [...text.matchAll(/\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g)].flatMap(([, label, href]) =>
    isChatFileLink(href) && !href.startsWith("data:")
      ? [{ title: label.trim() || basename(href), href }]
      : [],
  );
}

export function setDraft(convoId: string, text: string): void {
  set((s) => ({ drafts: { ...s.drafts, [convoId]: text } }));
}

export function setCitations(convoId: string, update: (list: Citation[]) => Citation[]): void {
  set((s) => ({ citations: { ...s.citations, [convoId]: update(s.citations[convoId] ?? []) } }));
}

export function showChat(id: string): void {
  set((s) => {
    if (!s.unseen.has(id)) return s.activeId === id ? s : { activeId: id };
    const unseen = new Set(s.unseen);
    unseen.delete(id);
    return { activeId: id, unseen };
  });
}

export function watchChat(id: string | null): void {
  set((s) => {
    if (!id || !s.unseen.has(id)) return s.watched === id ? s : { watched: id };
    const unseen = new Set(s.unseen);
    unseen.delete(id);
    return { watched: id, unseen };
  });
}

const WINDOW_ID = crypto.randomUUID();
let toldWatching: string | null = null;

/** Tells the account which agent session this window shows while it's in front, so its iPhones stay quiet about it. */
function tellWatching(): void {
  const { watched, conversations } = get();
  const session =
    watched && document.hasFocus()
      ? (conversations.find((c) => c.id === watched)?.sessionId ?? null)
      : null;
  if (session === toldWatching) return;
  toldWatching = session;
  void mailApi.agentWatching({ window: WINDOW_ID, session }).catch(() => {});
}

useChats.subscribe(tellWatching);
window.addEventListener("focus", tellWatching);
window.addEventListener("blur", tellWatching);
window.addEventListener("pagehide", () => {
  if (toldWatching === null) return;
  toldWatching = null;
  void mailApi.agentWatching({ window: WINDOW_ID, session: null }).catch(() => {});
});

/** Snoozing or settling a pinned chat unpins it; bringing one back puts it at the top. */
export async function shelveChat(
  id: string,
  change: Pick<Chat, "snoozedUntil" | "settledAt">,
): Promise<void> {
  if (!get().conversations.find((c) => c.id === id)?.loaded) await loadChat(id);
  const now = Date.now();
  patchConversation(id, (c) => {
    const away = c.settledAt != null || (c.snoozedUntil ?? 0) > now;
    const back = away && change.snoozedUntil == null && change.settledAt == null;
    return {
      ...c,
      ...change,
      ...(change.snoozedUntil != null || change.settledAt != null ? { pinnedAt: null } : {}),
      ...(back ? { returnedAt: now } : {}),
      updatedAt: now,
    };
  });
}

export async function pinChat(id: string, pinned: boolean): Promise<void> {
  if (!get().conversations.find((c) => c.id === id)?.loaded) await loadChat(id);
  const now = Date.now();
  patchConversation(id, (c) => ({
    ...c,
    pinnedAt: pinned ? now : null,
    ...(pinned ? { snoozedUntil: null, settledAt: null } : { returnedAt: now }),
    updatedAt: now,
  }));
}

export function discardDraft(id: string): void {
  const convo = get().conversations.find((c) => c.id === id);
  set((s) => {
    const drafts = { ...s.drafts };
    delete drafts[id];
    if (!convo || !isBlank(convo)) return { drafts };
    const conversations = s.conversations.filter((c) => c.id !== id);
    if (s.activeId !== id) return { drafts, conversations };
    const next = newConversation(convo.provider);
    return { drafts, conversations: [next, ...conversations], activeId: next.id };
  });
}

/** `onAgent`: the agent keeps chats' names too (its snapshot's `titles`). */
export async function renameChat(id: string, title: string, onAgent: boolean): Promise<void> {
  const name = title.trim();
  if (!get().conversations.find((c) => c.id === id)?.loaded) await loadChat(id);
  const convo = get().conversations.find((c) => c.id === id);
  if (!convo || !name || name === convo.title) return;
  patchConversation(id, (c) => ({ ...c, title: name, updatedAt: Date.now() }));
  if (onAgent && convo.sessionId)
    void mailApi.agentRetitle(convo.provider, convo.sessionId, { title: name }).catch(() => {});
}

/** A call started in a chat without a session: the session it started is the chat's. */
export function setChatSession(id: string, provider: ProviderKind, sessionId: string): void {
  patchConversation(id, (c) => (c.sessionId ? c : { ...c, provider, sessionId }));
}

/** The turn being said in a call, by chat and who's saying it. */
const saying = new Map<string, string>();

/** What's said in a call, as it's heard: a turn for each thing said, done once it's final. */
export function hearSpoken(id: string, role: ChatTurn["role"], text: string, final: boolean): void {
  const key = `${id}:${role}`;
  const turnId = saying.get(key) ?? `v-${crypto.randomUUID()}`;
  if (final) saying.delete(key);
  else saying.set(key, turnId);
  const now = Date.now();
  let first = false;
  patchConversation(id, (c) => {
    const was = c.turns.find((t) => t.id === turnId);
    const said = (
      final ? text : `${(was?.role === "user" ? was.text : spokenText(was)) ?? ""}${text}`
    ).trimStart();
    const turn: ChatTurn = {
      id: turnId,
      role,
      ...(role === "user" ? { text: said } : { text: "", items: [{ kind: "text", text: said }] }),
      spoken: true,
      startedAt: was?.startedAt ?? now,
      ...(final && { finishedAt: now }),
    };
    first = final && role === "user" && !c.turns.some((t) => t.role === "user" && t.id !== turnId);
    return {
      ...c,
      title: first ? clampTitle(text) : c.title,
      updatedAt: now,
      returnedAt: now,
      snoozedUntil: null,
      settledAt: null,
      turns: was ? c.turns.map((t) => (t.id === turnId ? turn : t)) : [...c.turns, turn],
    };
  });
  if (first) void regenerateTitle(id).catch(() => {});
}

/** The call ended: what was being said when it did is all of it. */
export function endSpoken(id: string): void {
  for (const role of ["user", "assistant"]) {
    const turnId = saying.get(`${id}:${role}`);
    if (!turnId) continue;
    saying.delete(`${id}:${role}`);
    const now = Date.now();
    patchConversation(id, (c) => ({
      ...c,
      turns: c.turns.map((t) => (t.id === turnId ? { ...t, finishedAt: t.finishedAt ?? now } : t)),
    }));
  }
}

const spokenText = (turn: ChatTurn | undefined) =>
  turn?.items?.map((item) => (item.kind === "text" ? item.text : "")).join("");

/** Asks the chat's agent to title it again from its first message. */
export async function regenerateTitle(id: string): Promise<void> {
  if (!get().conversations.find((c) => c.id === id)?.loaded) await loadChat(id);
  const convo = get().conversations.find((c) => c.id === id);
  const message = convo?.turns.find((t) => t.role === "user")?.text.trim();
  if (!convo?.sessionId || !message) return;
  const title = await mailApi.agentRetitle(convo.provider, convo.sessionId, { message });
  if (title)
    patchConversation(id, (c) => ({ ...c, title: clampTitle(title), updatedAt: Date.now() }));
}

export function newChat(provider: ProviderKind): string {
  const { conversations, drafts } = get();
  const blank = conversations.find((c) => isBlank(c) && !hasDraft(drafts, c.id));
  if (blank) {
    if (blank.provider !== provider) patchConversation(blank.id, (c) => ({ ...c, provider }));
    showChat(blank.id);
    return blank.id;
  }
  console.log("[AgentChat:newChat]");
  const fresh = newConversation(provider);
  set((s) => ({ conversations: [fresh, ...s.conversations], activeId: fresh.id }));
  return fresh.id;
}

export function deleteConversation(id: string, provider: ProviderKind): void {
  const running = get().runs[id];
  if (running) {
    void mailApi.agentCancel(running.provider, running.requestId);
    endRun(running.requestId);
  }
  const target = get().conversations.find((c) => c.id === id);
  if (!target) return;
  if (target.sessionId && target.sessionOwned) {
    void mailApi.agentDeleteSession(target.provider, target.sessionId).catch(() => {});
  }
  if (!isBlank(target)) void chatsApi.delete(id).catch(() => {});
  closeChatPages(id);
  set((s) => {
    const conversations = s.conversations.filter((c) => c.id !== id);
    const request = running?.requestId;
    const unseen = new Set(s.unseen);
    unseen.delete(id);
    const left = {
      approvals: s.approvals.filter((a) => a.requestId !== request),
      questions: s.questions.filter((q) => q.requestId !== request),
      unseen,
    };
    if (s.activeId !== id) return { conversations, ...left };
    const next = conversations[0] ?? newConversation(provider);
    return {
      conversations: conversations.includes(next) ? conversations : [next, ...conversations],
      activeId: next.id,
      ...left,
    };
  });
}

/** A new chat with the conversation up to this reply. */
export async function forkChat(convoId: string, turnId: string): Promise<string | undefined> {
  const convo = get().conversations.find((c) => c.id === convoId);
  const at = convo?.turns.findIndex((t) => t.id === turnId) ?? -1;
  if (!convo?.sessionId || at < 0) return;
  const later = convo.turns.slice(at + 1).filter((t) => t.role === "user");
  const sessionId = await mailApi.agentFork(
    convo.provider,
    convo.sessionId,
    later[0] && {
      requestId: later[0].id.startsWith("u-") ? later[0].id.slice("u-".length) : undefined,
      fromEnd: later.length - 1,
    },
  );
  console.log("[AgentChat:fork]", { provider: convo.provider, from: convo.sessionId, sessionId });
  const fork: Conversation = {
    ...newConversation(convo.provider),
    title: convo.title,
    sessionId,
    sessionOwned: true,
    device: convo.device,
    turns: convo.turns.slice(0, at + 1).map((t, i) => (i === at ? { ...t, forked: true } : t)),
  };
  set((s) => ({ conversations: [fork, ...s.conversations], activeId: fork.id }));
  return fork.id;
}

export function openServerSession(
  session: ChatSession,
  provider: ProviderKind,
  providerName: string,
): void {
  const existing = get().conversations.find(
    (c) => c.sessionId === session.id && c.provider === provider,
  );
  if (existing) {
    showChat(existing.id);
    return;
  }
  console.log("[AgentChat:openServerSession]", {
    provider,
    sessionId: session.id,
    source: session.source,
  });
  const convo: Conversation = {
    ...newConversation(provider),
    title: clampTitle(session.title || session.preview || `${providerName} session`),
    sessionId: session.id,
    updatedAt: session.lastActive,
  };
  set((s) => ({
    conversations: [
      convo,
      ...s.conversations.filter(
        (c) => !isBlank(c) || c.id === s.activeId || hasDraft(s.drafts, c.id),
      ),
    ],
    activeId: convo.id,
    hydrating: convo.id,
  }));
  mailApi
    .agentSessionMessages(provider, session.id)
    .then(
      (messages) => {
        const hydrated = turnsFromMessages(messages);
        patchConversation(convo.id, (c) =>
          c.turns.length > 0 ? c : { ...c, turns: hydrated, updatedAt: Date.now() },
        );
      },
      (error) => console.log("[AgentChat:hydrate] failed", { error: String(error) }),
    )
    .finally(() => set((s) => (s.hydrating === convo.id ? { hydrating: null } : s)));
}

const resumeTried = new Map<string, ProviderSnapshot>();

/**
 * A turn the app quit during (or lost the connection in) is picked up
 * again: the provider shows how far its run got, then streams the rest.
 * Tried once per provider state, so a gateway that comes back retries it.
 */
export function resumeRuns(providers: ProviderSnapshot[]): void {
  for (const c of get().conversations) {
    const requestId = c.openRequest;
    const host = providers.find((p) => p.kind === c.provider);
    if (!requestId || !c.sessionId || get().runs[c.id] || !host || !isProviderUsable(host))
      continue;
    if (resumeTried.get(requestId) === host) continue;
    resumeTried.set(requestId, host);
    console.log("[AgentChat:resume]", { provider: c.provider, requestId });
    const sessionId = c.sessionId;
    const giveUp = () => {
      patchConversation(c.id, (current) =>
        current.openRequest === requestId ? { ...current, openRequest: null } : current,
      );
      endRun(requestId);
    };
    void (async () => {
      // The run's turns stream after the chat's own, so those come first.
      if (!c.loaded) await loadChat(c.id);
      if (get().runs[c.id]) return;
      set((s) => ({
        runs: { ...s.runs, [c.id]: { requestId, convoId: c.id, provider: c.provider } },
      }));
      try {
        const { resumed } = await mailApi.agentResume({
          provider: c.provider,
          requestId,
          sessionId,
        });
        if (!resumed) giveUp();
      } catch (error) {
        console.log("[AgentChat:resume] failed", { error: String(error) });
        endRun(requestId);
      }
    })();
  }
}

const watchedSessions = new Map<ProviderKind, string>();

/** This device's chats with a session, so the provider can show runs the agent starts itself. */
function watchSessions(providers: ProviderSnapshot[]): void {
  const { conversations, device } = get();
  for (const host of providers) {
    if (!isProviderUsable(host)) {
      // Turned off, it stopped watching: watched again once it's back.
      watchedSessions.delete(host.kind);
      continue;
    }
    const sessions = conversations
      .filter((c) => c.provider === host.kind && c.sessionId && !isElsewhere(c, device))
      .map((c) => ({
        id: c.sessionId!,
        // A turn in flight is picked up again with all it led to: nothing to catch up on.
        since: c.openRequest
          ? Number.MAX_SAFE_INTEGER
          : (c.turns.findLast((t) => t.finishedAt)?.finishedAt ?? c.updatedAt),
        ...(c.cursor && { cursor: c.cursor }),
      }));
    // Watched again once it's connected: an agent's sessions with no chat yet are found then too.
    const key = JSON.stringify([host.installed, host.status, sessions]);
    if (watchedSessions.get(host.kind) === key) continue;
    watchedSessions.set(host.kind, key);
    void mailApi.agentWatch(host.kind, sessions).catch(() => watchedSessions.delete(host.kind));
  }
}

type AgentRun = {
  provider: ProviderKind;
  sessionId: string;
  requestId: string;
  chat?: { title: string };
  deliveredAt?: number;
  delivery?: ChatDelivery;
};

/** What an agent delivered recently enough to notify about once it's read (by request id). */
const deliveries = new Map<string, { title: string; subtitle: string }>();
const DELIVERY_NOTIFIES_MS = 10 * 60 * 1000;

/** The chat for a session that has none: what an agent delivered to Otter. Every device makes the same one. */
function chatForSession(run: AgentRun, title: string): Conversation {
  const id = `${run.provider}-${run.sessionId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  const existing = get().conversations.find((c) => c.id === id);
  if (existing) return existing;
  const convo: Conversation = {
    ...newConversation(run.provider),
    id,
    title: clampTitle(title),
    sessionId: run.sessionId,
  };
  set((s) => ({ conversations: [convo, ...s.conversations] }));
  return convo;
}

/** Runs that started while their chat had a turn going: followed once it ends. */
const waitingRuns = new Map<string, AgentRun[]>();

/** A run the agent started on its own (a completion it was woken for): a turn of its own, without a message. */
async function followAgentRun(run: AgentRun): Promise<void> {
  const convo =
    get().conversations.find((c) => c.provider === run.provider && c.sessionId === run.sessionId) ??
    (run.chat ? chatForSession(run, run.chat.title) : undefined);
  if (!convo) return;
  if (run.deliveredAt !== undefined && Date.now() - run.deliveredAt < DELIVERY_NOTIFIES_MS)
    deliveries.set(run.requestId, {
      title: convo.title,
      subtitle:
        run.delivery?.kind === "automation"
          ? (run.delivery.name ?? "Scheduled task")
          : "Sent you a message",
    });
  const wait = () => {
    waitingRuns.set(convo.id, [...(waitingRuns.get(convo.id) ?? []), run]);
  };
  if (get().runs[convo.id]) return wait();
  if (!convo.loaded) await loadChat(convo.id);
  const turnId = `a-${run.requestId}`;
  const current = get().conversations.find((c) => c.id === convo.id);
  if (!current || current.turns.some((t) => t.id === turnId)) return;
  if (get().runs[convo.id]) return wait();
  // A turn about to be picked up again follows what it led to itself.
  if (current.openRequest) return;
  console.log("[AgentChat:agentRun]", { provider: run.provider, requestId: run.requestId });
  set((s) => ({
    runs: {
      ...s.runs,
      [convo.id]: { requestId: run.requestId, convoId: convo.id, provider: run.provider },
    },
  }));
  // Something new from the agent (a scheduled task still running, say) brings a settled or snoozed chat back.
  const now = Date.now();
  const away = current.settledAt != null || (current.snoozedUntil ?? 0) > now;
  patchConversation(convo.id, (c) => ({
    ...c,
    ...(away && { settledAt: null, snoozedUntil: null, returnedAt: now, updatedAt: now }),
    turns: [
      ...c.turns,
      {
        id: turnId,
        role: "assistant",
        text: "",
        items: [],
        startedAt: run.deliveredAt ?? now,
        ...(run.delivery && { delivered: run.delivery }),
      },
    ],
    openRequest: run.requestId,
  }));
  const drop = () => {
    patchConversation(convo.id, (c) => ({
      ...c,
      turns: c.turns.filter((t) => t.id !== turnId),
      openRequest: c.openRequest === run.requestId ? null : c.openRequest,
    }));
    endRun(run.requestId);
  };
  try {
    const { resumed } = await mailApi.agentResume(run);
    if (!resumed) drop();
  } catch (error) {
    console.log("[AgentChat:agentRun] failed", { error: String(error) });
    drop();
  }
}

/** A run of the agent's own that ended without writing anything (it had nothing to say) leaves no turn. */
function isSilentAgentTurn(convoId: string, requestId: string): boolean {
  const turns = get().conversations.find((c) => c.id === convoId)?.turns ?? [];
  const turn = turns.find((t) => t.id === `a-${requestId}`);
  return Boolean(
    turn &&
    !turns.some((t) => t.id === `u-${requestId}`) &&
    !turn.text &&
    !turn.error &&
    !(turn.items ?? []).some((item) => item.kind === "step" || item.text.trim()),
  );
}

/** Every window reports what an agent asks; core notifies once, when none of them had focus. */
function notifyAsk(run: Run, id: string, title: string, body?: string): void {
  const key = `${run.provider}:${run.requestId}:${id}`;
  const focused = document.hasFocus();
  void mailApi
    .agentNotifyAsk({ provider: run.provider, key, title, body, chat: run.convoId, focused })
    .catch(() => {});
}

/**
 * An answer to the user's message, or what an agent delivered, once it's all
 * here: notifies like an ask, only when no window has focus.
 */
function notifyFinished(run: Run): void {
  const delivered = deliveries.get(run.requestId);
  deliveries.delete(run.requestId);
  const convo = get().conversations.find((c) => c.id === run.convoId);
  if (!convo) return;
  if (!delivered && !convo.turns.some((t) => t.id === `u-${run.requestId}`)) return;
  const text = convo.turns
    .find((t) => t.id === `a-${run.requestId}`)
    ?.items?.findLast((item) => item.kind === "text")
    ?.text.trim();
  if (!text) return;
  const key = `${run.provider}:${run.requestId}`;
  void mailApi
    .agentNotifyAsk({
      provider: run.provider,
      key,
      title: delivered?.title ?? convo.title,
      subtitle: delivered?.subtitle ?? "Finished",
      chat: run.convoId,
      body: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      focused: document.hasFocus(),
    })
    .catch(() => {});
}

function onChatEvent(raw: unknown): void {
  const event = raw as ChatEvent;
  if (event?.type === "title") {
    const turnId = `a-${event.requestId}`;
    const convo = get().conversations.find((c) => c.turns.some((t) => t.id === turnId));
    if (convo)
      patchConversation(convo.id, (c) => ({
        ...c,
        title: clampTitle(event.title),
        updatedAt: Date.now(),
      }));
    return;
  }
  const s = event
    ? Object.values(get().runs).find((r) => r.requestId === event.requestId)
    : undefined;
  if (!event || !s) return;
  const opens: {
    result: { ref: ChatTabRef; title: string; made: boolean } | null;
    pages: string[];
    files: { title: string; href: string }[];
    retry: { turnId: string; msg: Outgoing } | null;
  } = { result: null, pages: [], files: [], retry: null };
  if (event.type === "approval") {
    set((st) => ({
      approvals: [...st.approvals, { requestId: event.requestId, approval: event.approval }],
    }));
    notifyAsk(s, `approval:${event.approval.id}`, event.approval.title, event.approval.detail);
    return;
  }
  if (event.type === "approvalResolved") {
    set((st) => ({ approvals: st.approvals.filter((a) => a.approval.id !== event.approvalId) }));
    return;
  }
  if (event.type === "question") {
    set((st) => ({
      questions: [
        ...st.questions.filter((q) => q.question.id !== event.question.id),
        { requestId: event.requestId, question: event.question },
      ],
    }));
    const first = event.question.questions[0];
    notifyAsk(
      s,
      `question:${event.question.id}`,
      first?.header || "A question for you",
      first?.question,
    );
    return;
  }
  if (event.type === "questionResolved") {
    set((st) => ({ questions: st.questions.filter((q) => q.question.id !== event.questionId) }));
    return;
  }
  if (event.type === "done" || event.type === "error") {
    set((st) => ({
      approvals: st.approvals.filter((a) => a.requestId !== event.requestId),
      questions: st.questions.filter((q) => q.requestId !== event.requestId),
    }));
  }
  if (event.type === "error" && event.message === "detached") {
    endRun(event.requestId);
    return;
  }
  if (event.type === "transcript") {
    // Its turn gone (the chat was replaced under it), it would land on another.
    const turns = get().conversations.find((c) => c.id === s.convoId)?.turns ?? [];
    if (!turns.some((t) => t.id === `a-${event.requestId}` || t.id === `u-${event.requestId}`))
      return;
    patchConversation(s.convoId, (c) => ({
      ...c,
      turns: withTranscript(c.turns, event.requestId, event.messages),
      updatedAt: event.messages.length > 0 ? Date.now() : c.updatedAt,
    }));
    return;
  }
  if (event.type === "done") notifyFinished(s);
  if (event.type === "done" && isSilentAgentTurn(s.convoId, event.requestId)) {
    patchConversation(s.convoId, (c) => ({
      ...c,
      turns: c.turns.filter((t) => t.id !== `a-${event.requestId}`),
      openRequest: c.openRequest === event.requestId ? null : c.openRequest,
    }));
    endRun(event.requestId);
    return;
  }
  patchConversation(s.convoId, (c) => {
    if (event.type === "session") return { ...c, sessionId: event.sessionId, sessionOwned: true };
    const nextTurns = [...c.turns];
    // What's said in a call meanwhile comes after the run's reply, and isn't part of it.
    const at = nextTurns.findLastIndex((t) => !t.spoken);
    const turn = nextTurns[at];
    if (!turn || turn.role !== "assistant") return c;
    const items = [...(turn.items ?? [])];
    const updated: ChatTurn = { ...turn, items };
    const last = items[items.length - 1];
    if (event.type === "change") {
      updated.changes = mergeChatChanges([...(turn.changes ?? []), event.change]);
      opens.result = changeTab(event.change);
    } else if (event.type === "delta" || event.type === "text") {
      // Text continues the text before it; after a step it starts anew.
      const index = event.id
        ? items.findIndex((item) => item.kind === "text" && item.id === event.id)
        : last?.kind === "text"
          ? items.length - 1
          : -1;
      const previous = items[index];
      if (previous?.kind === "text")
        items[index] = {
          ...previous,
          text: event.type === "text" ? event.text : previous.text + event.text,
        };
      else items.push({ kind: "text", id: event.id, text: event.text });
    } else if (event.type === "tool") {
      items.push({ kind: "step", id: event.id, step: event.step });
      const url = event.step.kind === "web" ? event.step.detail?.trim() : undefined;
      if (url && /^https?:\/\//i.test(url)) opens.pages.push(url);
    } else if (event.type === "toolResult") {
      // A step with an id takes its latest result: a fuller one can follow a bare "done".
      const byId = event.id
        ? items.findLastIndex((t) => t.kind === "step" && t.id === event.id)
        : -1;
      const index =
        byId >= 0
          ? byId
          : items.findLastIndex(
              (t) =>
                t.kind === "step" &&
                t.output === undefined &&
                !t.step.compaction &&
                (event.id === undefined || t.id === undefined || t.id === event.id),
            );
      // A step from before a steer finishes in the reply it started in: by its id, or, for an
      // agent without ids (Hermes takes a steer only after its running tools), the step still
      // running there when none runs here.
      const belongs = (item: ChatTurnItem) =>
        item.kind === "step" &&
        (event.id ? item.id === event.id : item.output === undefined && !item.step.compaction);
      const earlier =
        byId < 0 && (event.id || index < 0)
          ? nextTurns.findLastIndex(
              (t) =>
                t !== turn && t.role === "assistant" && !t.finishedAt && t.items?.some(belongs),
            )
          : -1;
      const step = items[index];
      if (earlier >= 0) {
        const before = nextTurns[earlier];
        const at = before.items!.findIndex(belongs);
        nextTurns[earlier] = {
          ...before,
          items: before.items!.map((item, i) =>
            i === at ? { ...item, output: event.output } : item,
          ),
        };
      } else if (step?.kind === "step") items[index] = { ...step, output: event.output };
    } else if (event.type === "error") {
      updated.error = friendlyError(event.message, s.provider);
      const msg = sent.get(event.requestId) ?? resendable(c, event.requestId);
      if (msg && updated.id === `a-${event.requestId}` && !FINAL.has(event.message))
        opens.retry = { turnId: updated.id, msg };
    }
    if (event.type === "done" || event.type === "error") {
      updated.finishedAt = Date.now();
      // A step whose result never came isn't running any more.
      items.forEach((item, i) => {
        if (item.kind === "step" && item.output === undefined) items[i] = { ...item, output: "" };
      });
      const run = runReplyIds(nextTurns);
      nextTurns.forEach((t, i) => {
        if (t === turn || !run.has(t.id) || t.finishedAt) return;
        nextTurns[i] = {
          ...t,
          finishedAt: updated.finishedAt,
          items: t.items?.map((item) =>
            item.kind === "step" && item.output === undefined ? { ...item, output: "" } : item,
          ),
        };
      });
      for (const item of items) {
        if (item.kind === "text") opens.files.push(...linkedFiles(item.text));
        else if (item.step.kind === "edit")
          for (const path of (item.step.detail ?? "").split("\n").filter(Boolean))
            opens.files.push({ title: basename(path), href: path });
      }
    }
    nextTurns[at] = updated;
    if (event.type === "done" && updated.delivered) placeDelivered(nextTurns);
    const lastResponseId =
      event.type === "done" && event.responseId ? event.responseId : c.lastResponseId;
    const sessionId =
      event.type === "error" && event.message === "session_not_found" ? null : c.sessionId;
    const snoozedUntil = event.type === "done" || event.type === "error" ? null : c.snoozedUntil;
    return {
      ...c,
      turns: nextTurns,
      lastResponseId,
      sessionId,
      snoozedUntil,
      updatedAt: Date.now(),
    };
  });
  if (opens.result)
    openChatTab(s.convoId, opens.result.ref, opens.result.title, { made: opens.result.made });
  for (const url of opens.pages)
    openChatTab(s.convoId, { kind: "page", url }, hostOf(url), { show: false });
  for (const file of opens.files)
    openChatTab(s.convoId, { kind: "file", href: file.href }, file.title, {
      show: false,
      made: true,
    });
  if (opens.retry) {
    const { turnId, msg } = opens.retry;
    set((st) => ({ retries: { ...st.retries, [turnId]: msg } }));
  }
  if (event.type === "done" || event.type === "error") {
    set((st) => ({
      conversations: st.conversations.map((c) =>
        c.openRequest === event.requestId ? { ...c, openRequest: null } : c,
      ),
      unseen: s.convoId === st.watched ? st.unseen : new Set(st.unseen).add(s.convoId),
    }));
    endRun(event.requestId);
  }
  if (event.type === "steerReturned") {
    set((st) => ({
      queue: [
        {
          id: crypto.randomUUID(),
          convoId: s.convoId,
          provider: s.provider,
          question: event.text,
          input: event.text,
          title: clampTitle(event.text),
        },
        ...st.queue,
      ],
    }));
    startQueued();
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export function useChatEvents(): void {
  const providers = useAgentProviders().data?.providers;
  useEffect(() => {
    if (!providers) return;
    resumeRuns(providers);
    if (get().ready) watchSessions(providers);
    return useChats.subscribe((s, prev) => {
      if (s.conversations !== prev.conversations || s.runs !== prev.runs) resumeRuns(providers);
      if (s.ready && s.conversations !== prev.conversations) watchSessions(providers);
    });
  }, [providers]);
  useEffect(() => {
    void loadChats().catch((error: unknown) =>
      console.log("[AgentChat:load] failed", { error: String(error) }),
    );
    const offs = [
      window.desktopBridge.on("agent:chatEvent", onChatEvent),
      window.desktopBridge.on("agent:runStarted", (params: unknown) => {
        const run = params as AgentRun | undefined;
        if (run?.provider && run.sessionId && run.requestId) void followAgentRun(run);
      }),
      window.desktopBridge.on("agent:sessionRead", (params: unknown) => {
        const read = params as { provider?: ProviderKind; sessionId?: string; cursor?: string };
        const convo = get().conversations.find(
          (c) => c.provider === read?.provider && c.sessionId === read.sessionId,
        );
        if (!convo || !read.cursor || convo.cursor === read.cursor) return;
        void loadChat(convo.id).then(() =>
          patchConversation(convo.id, (c) => ({ ...c, cursor: read.cursor })),
        );
      }),
      window.desktopBridge.on("chats:changed", (params: unknown) => {
        const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
        if (ids.length > 0 && ids.every((id) => saving.has(id))) return;
        // Written elsewhere (the relay, another tab): what this window keeps of them goes whole next time.
        for (const c of get().conversations)
          if (ids.includes(c.id) && !saving.has(c.id))
            for (const turn of c.turns) stored.delete(turn);
        reloadTimer ??= setTimeout(() => {
          reloadTimer = null;
          void loadChats().catch(() => {});
        }, 200);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}
