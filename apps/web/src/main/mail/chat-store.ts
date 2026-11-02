import { useEffect } from "react";
import { create } from "zustand";
import {
  LOCAL_CHAT_PROVIDERS,
  chatTabId,
  type Chat,
  type ChatContextMeta,
  type ChatTab,
  type ChatTabRef,
  type ChatTurn,
} from "@otter-mail/contracts/chats";

import { ipc } from "~/lib/ipc";
import { EXTENSIONS } from "../extensions/registry";
import { closeChatPages } from "../browser/store";
import { isProviderUsable, useAgentProviders } from "./agent-providers";
import {
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
} from "./api";
import type { SentAttachment } from "./chat-attachments";
import { mergeChatChanges } from "./chat-changes";
import type { Citation } from "./chat-cite";
import { isChatFileLink } from "./chat-links";
import type { FollowUpBehavior } from "./chat-queue";
import { toast } from "./toast";

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

/** A turn in flight, bound to its conversation (several chats can run at once). */
export type Run = { requestId: string; convoId: string; provider: ProviderKind };

/** A composed message, before it becomes a turn (or a steer). */
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
  /** The account's chats, newest first, and a new one before its first message. */
  conversations: Conversation[];
  ready: boolean;
  device: Device | null;
  activeId: string;
  docked: string[];
  activeTabs: Record<string, string>;
  watched: string | null;
  /** Turns in flight, by chat: each streams into its own chat, so chats work in parallel. */
  runs: Record<string, Run>;
  unseen: ReadonlySet<string>;
  approvals: { requestId: string; approval: ApprovalRequest }[];
  questions: { requestId: string; question: ChatQuestion }[];
  queue: QueuedMessage[];
  editingQueued: string | null;
  hydrating: string | null;
  drafts: Record<string, string>;
  citations: Record<string, Citation[]>;
};

const ACTIVE_KEY = "gmail:chat-active";
const ACTIVE_TABS_KEY = "gmail:chat-active-tabs";
const DOCKED_KEY = "gmail:chat-docked";
const MAX_DOCKED = 5;
const OPEN_REQUESTS_KEY = "gmail:chat-open-requests";
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

function newConversation(provider: ProviderKind = "openrouter"): Conversation {
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
    tabs: [],
    turns: [],
    loaded: true,
  };
}

/** A new chat, before its first message: nowhere but here. */
export const isBlank = (c: Conversation) => c.loaded && c.turns.length === 0;

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
      for (const step of m.toolCalls ?? []) open.items!.push({ kind: "step", step });
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
  let at = turns.findIndex((t) => t.id === `u-${requestId}`);
  if (at < 0) at = turns.findLastIndex((t) => t.role === "user");
  const local = turns.slice(at + 1);
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
    next = recorded.map((t, i) => (i === 0 && t.role === "assistant" ? { ...t, startedAt } : t));
  }
  if (next[next.length - 1]?.role !== "assistant")
    next.push({ id: `a-${requestId}-rest`, role: "assistant", text: "", items: [], startedAt });
  return [...turns.slice(0, at + 1), ...next];
}

function friendlyError(code: string, provider: ProviderKind): string {
  const name = EXTENSIONS.find((e) => e.manifest.id === provider)?.manifest.name ?? provider;
  switch (code) {
    case "not_configured":
      return `${name} isn't set up — connect it in Settings → Agents.`;
    case "not_installed":
      return "The Codex CLI wasn't found — check it in Settings → Agents.";
    case "provider_disabled":
      return `${name} is turned off in Settings → Agents.`;
    case "unauthorized":
      return "The API key was rejected — update it in Settings.";
    case "unreachable":
      if (provider === "openrouter") return "Can't reach OpenRouter. Try again in a moment.";
      if (provider === "openclaw")
        return "Can't reach the OpenClaw gateway — are you on Tailscale?";
      return provider === "codex"
        ? "Lost the connection to Codex — send again to retry."
        : "Can't reach Hermes — are you on Tailscale?";
    case "timeout":
      return `${name} went quiet for too long — the run was stopped.`;
    case "cancelled":
      return "Stopped.";
    case "pairing_required":
      return "Approve this device on the OpenClaw gateway — the command is in Settings → Agents.";
    case "origin_not_allowed":
      return "The OpenClaw gateway doesn't allow this site yet — see Settings → Agents.";
    case "session_not_found":
      return `This chat's ${name} session no longer exists — send again to start a new one.`;
    case "not_received":
      return `${name} never got this message — send it again.`;
    default:
      return code.startsWith("agent_error: ")
        ? code.slice("agent_error: ".length)
        : `${name} answered with an error (${code}).`;
  }
}

export const useChats = create<ChatsState>(() => ({
  conversations: [],
  ready: false,
  device: null,
  activeId: localStorage.getItem(ACTIVE_KEY) ?? "",
  docked: readJson<string[]>(DOCKED_KEY, []),
  activeTabs: readJson<Record<string, string>>(ACTIVE_TABS_KEY, {}),
  watched: null,
  runs: {},
  unseen: new Set(),
  approvals: [],
  questions: [],
  queue: [],
  editingQueued: null,
  hydrating: null,
  drafts: {},
  citations: {},
}));

const { getState: get, setState: set } = useChats;

const chatsApi = {
  list: () => ipc<{ chats: Omit<Chat, "turns">[]; device: Device }>("chats:list"),
  get: (id: string) => ipc<Chat | null>("chats:get", { id }),
  /** `settled`: no turn runs in it, so other devices can have it now (else in a while). */
  save: (chat: Chat, settled: boolean) => ipc<void>("chats:save", { chat, settled }),
  delete: (id: string) => ipc<void>("chats:delete", { id }),
};

/** The turns in flight when the app last quit, read before anything writes the key again. */
const savedOpenRequests = readJson<Record<string, string>>(OPEN_REQUESTS_KEY, {});
/** Chats core has listed: one gone from its list was deleted, one never in it is new here. */
const coreIds = new Set<string>();

const fromCore = new WeakSet<Conversation>();
const asLoaded = (c: Conversation) => (fromCore.add(c), c);

const toChat = ({ openRequest: _open, loaded: _loaded, ...chat }: Conversation): Chat => chat;

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
      saving.add(id);
      chatsApi
        .save(toChat(convo), !get().runs[id])
        .catch((error: unknown) => console.log("[AgentChat:save] failed", { error: String(error) }))
        .finally(() => saving.delete(id));
    }, 1500),
  );
}

useChats.subscribe((state, prev) => {
  if (state.activeId !== prev.activeId) localStorage.setItem(ACTIVE_KEY, state.activeId);
  if (state.docked !== prev.docked) localStorage.setItem(DOCKED_KEY, JSON.stringify(state.docked));
  if (state.activeTabs !== prev.activeTabs)
    localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(state.activeTabs));
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
      const blank = conversations.find(isBlank) ?? newConversation();
      if (!conversations.includes(blank)) conversations.unshift(blank);
      activeId = blank.id;
    }
    return { conversations, device, ready: true, activeId, unseen };
  });
}

const loading = new Set<string>();

export async function loadChat(id: string): Promise<void> {
  if (loading.has(id)) return;
  loading.add(id);
  try {
    const chat = await chatsApi.get(id);
    if (!chat) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id && !c.loaded
          ? asLoaded({ ...chat, loaded: true, openRequest: c.openRequest })
          : c,
      ),
    }));
  } finally {
    loading.delete(id);
  }
}

function patchConversation(id: string, fn: (c: Conversation) => Conversation): void {
  set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)) }));
}

function endRun(requestId: string): void {
  const entry = Object.values(get().runs).find((r) => r.requestId === requestId);
  if (!entry) return;
  set((s) => {
    const runs = { ...s.runs };
    delete runs[entry.convoId];
    return { runs };
  });
  startQueued();
}

/**
 * A chat's queued message starts once no turn is running in it (after
 * completion, an error, or Stop) — never at a tool boundary; that's what
 * Steer is for. Each chat drains its own queue.
 */
function startQueued(): void {
  for (;;) {
    const { queue, runs, editingQueued } = get();
    const next = queue.find((m) => !runs[m.convoId] && m.id !== editingQueued);
    if (!next) return;
    set({ queue: queue.filter((m) => m.id !== next.id) });
    startTurn(next, "queued");
  }
}

function appendExchange(
  convoId: string,
  msg: Outgoing,
  requestKey: string,
  intent?: ChatTurn["intent"],
): void {
  patchConversation(convoId, (c) => ({
    ...c,
    updatedAt: Date.now(),
    turns: [
      ...c.turns.map((t, i) =>
        i === c.turns.length - 1 && t.role === "assistant" && !t.finishedAt
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
  set((s) => ({
    runs: { ...s.runs, [msg.convoId]: { requestId, convoId: msg.convoId, provider: kind } },
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
  if (followUp === "queue" || msg.attachments) set((s) => ({ queue: [...s.queue, msg] }));
  else steer(msg);
}

export function steerQueued(id: string): void {
  const msg = get().queue.find((m) => m.id === id);
  if (!msg || !get().runs[msg.convoId]) return;
  set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
  steer(msg, "promoted");
}

/** Drag / arrow-key reorder: move `id` before `beforeId` (null = to the end). */
export function moveQueued(id: string, beforeId: string | null): void {
  set((s) => {
    const moving = s.queue.find((m) => m.id === id);
    if (!moving || id === beforeId) return s;
    const rest = s.queue.filter((m) => m.id !== id);
    const at = beforeId === null ? rest.length : rest.findIndex((m) => m.id === beforeId);
    return at < 0 ? s : { queue: [...rest.slice(0, at), moving, ...rest.slice(at)] };
  });
}

export function removeQueued(id: string): void {
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

export function setEditingQueued(id: string | null): void {
  if (get().editingQueued === id) return;
  set({ editingQueued: id });
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

export function openChatTab(
  convoId: string,
  ref: ChatTabRef,
  title: string,
  { show = true }: { show?: boolean } = {},
): void {
  const id = chatTabId(ref);
  set((s) => {
    const convo = s.conversations.find((c) => c.id === convoId);
    if (!convo) return s;
    const conversations = convo.tabs.some((t) => t.id === id)
      ? s.conversations
      : s.conversations.map((c) =>
          c === convo
            ? {
                ...c,
                tabs: [...c.tabs, { id, title: clampTitle(title), ref, addedAt: Date.now() }],
                updatedAt: Date.now(),
              }
            : c,
        );
    const activeTabs =
      show || !s.activeTabs[convoId] ? { ...s.activeTabs, [convoId]: id } : s.activeTabs;
    return { conversations, activeTabs };
  });
}

export function showChatTab(convoId: string, tabId: string): void {
  set((s) => ({ activeTabs: { ...s.activeTabs, [convoId]: tabId } }));
}

/** Closes a tab; the one before it shows (or after it, for the first). */
export function closeChatTab(convoId: string, tabId: string): void {
  set((s) => {
    const convo = s.conversations.find((c) => c.id === convoId);
    const at = convo?.tabs.findIndex((t) => t.id === tabId) ?? -1;
    if (!convo || at < 0) return s;
    const tabs = convo.tabs.filter((t) => t.id !== tabId);
    const shown = s.activeTabs[convoId];
    const activeTabs = { ...s.activeTabs };
    if (shown === tabId || !shown) {
      const next = tabs[at - 1] ?? tabs[at];
      if (next) activeTabs[convoId] = next.id;
      else delete activeTabs[convoId];
    }
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

function changeTab(change: ChatChange): { ref: ChatTabRef; title: string } | null {
  const { target } = change;
  if (target.kind === "thread" || target.kind === "draft")
    return {
      ref: { kind: target.kind, accountId: target.accountId, id: target.id },
      title: change.title,
    };
  if (target.kind === "event" && target.url && change.action !== "deleted")
    return { ref: { kind: "page", url: target.url }, title: change.title };
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

export function dockChat(id: string): void {
  set((s) => (s.docked.includes(id) ? s : { docked: [...s.docked, id].slice(-MAX_DOCKED) }));
}

export function undockChat(id: string): void {
  set((s) => (s.docked.includes(id) ? { docked: s.docked.filter((d) => d !== id) } : s));
}

export function watchChat(id: string | null): void {
  set((s) => {
    if (!id || !s.unseen.has(id)) return s.watched === id ? s : { watched: id };
    const unseen = new Set(s.unseen);
    unseen.delete(id);
    return { watched: id, unseen };
  });
}

export function newChat(provider: ProviderKind): string {
  const blank = get().conversations.find(isBlank);
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
      docked: s.docked.filter((d) => d !== id),
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
    conversations: [convo, ...s.conversations.filter((c) => !isBlank(c) || c.id === s.activeId)],
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

function onChatEvent(raw: unknown): void {
  const event = raw as ChatEvent;
  const s = event
    ? Object.values(get().runs).find((r) => r.requestId === event.requestId)
    : undefined;
  if (!event || !s) return;
  const opens: {
    result: { ref: ChatTabRef; title: string } | null;
    pages: string[];
    files: { title: string; href: string }[];
  } = { result: null, pages: [], files: [] };
  if (event.type === "approval") {
    set((st) => ({
      approvals: [...st.approvals, { requestId: event.requestId, approval: event.approval }],
    }));
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
    patchConversation(s.convoId, (c) => ({
      ...c,
      turns: withTranscript(c.turns, event.requestId, event.messages),
      updatedAt: Date.now(),
    }));
    return;
  }
  patchConversation(s.convoId, (c) => {
    if (event.type === "session") return { ...c, sessionId: event.sessionId, sessionOwned: true };
    const nextTurns = [...c.turns];
    const turn = nextTurns[nextTurns.length - 1];
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
      const index = items.findLastIndex(
        (t) =>
          t.kind === "step" &&
          t.output === undefined &&
          (event.id === undefined || t.id === undefined || t.id === event.id),
      );
      const step = items[index];
      if (step?.kind === "step") items[index] = { ...step, output: event.output };
    } else if (event.type === "error") {
      updated.error = friendlyError(event.message, s.provider);
    }
    if (event.type === "done" || event.type === "error") {
      updated.finishedAt = Date.now();
      for (const item of items) {
        if (item.kind === "text") opens.files.push(...linkedFiles(item.text));
        else if (item.step.kind === "edit")
          for (const path of (item.step.detail ?? "").split("\n").filter(Boolean))
            opens.files.push({ title: basename(path), href: path });
      }
    }
    nextTurns[nextTurns.length - 1] = updated;
    const lastResponseId =
      event.type === "done" && event.responseId ? event.responseId : c.lastResponseId;
    // A session deleted elsewhere: unbind so the next send starts a fresh one.
    const sessionId =
      event.type === "error" && event.message === "session_not_found" ? null : c.sessionId;
    return { ...c, turns: nextTurns, lastResponseId, sessionId, updatedAt: Date.now() };
  });
  if (opens.result) openChatTab(s.convoId, opens.result.ref, opens.result.title);
  for (const url of opens.pages)
    openChatTab(s.convoId, { kind: "page", url }, hostOf(url), { show: false });
  for (const file of opens.files)
    openChatTab(s.convoId, { kind: "file", href: file.href }, file.title, { show: false });
  if (event.type === "done" || event.type === "error") {
    set((st) => ({
      conversations: st.conversations.map((c) =>
        c.openRequest === event.requestId ? { ...c, openRequest: null } : c,
      ),
      unseen: s.convoId === st.watched ? st.unseen : new Set(st.unseen).add(s.convoId),
    }));
    endRun(event.requestId);
  }
  // A steer the agent never got to: it goes first in line.
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
    return useChats.subscribe((s, prev) => {
      if (s.conversations !== prev.conversations || s.runs !== prev.runs) resumeRuns(providers);
    });
  }, [providers]);
  useEffect(() => {
    void loadChats().catch((error: unknown) =>
      console.log("[AgentChat:load] failed", { error: String(error) }),
    );
    const offs = [
      window.desktopBridge.on("agent:chatEvent", onChatEvent),
      window.desktopBridge.on("chats:changed", (params: unknown) => {
        const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
        if (ids.length > 0 && ids.every((id) => saving.has(id))) return;
        reloadTimer ??= setTimeout(() => {
          reloadTimer = null;
          void loadChats().catch(() => {});
        }, 200);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}
