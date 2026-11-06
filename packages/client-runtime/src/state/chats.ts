import {
  LOCAL_CHAT_PROVIDERS,
  chatTabId,
  type ApprovalDecision,
  type ApprovalRequest,
  type Chat,
  type ChatAttachment,
  type ChatContextMeta,
  type ChatEvent,
  type ChatQuestion,
  type ChatSentAttachment,
  type ChatSession,
  type ChatSessionMessage,
  type ChatTab,
  type ChatTabRef,
  type ChatTurn,
  type Skill,
} from "@otter-mail/contracts/chats";
import type { ChatChange } from "@otter-mail/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { CoreBridge } from "../connection/index.ts";
import { readJson, type ClientPlatform } from "../platform/index.ts";

export type { ChatTab, ChatTurn };

type ProviderKind = string;

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

export type Citation = { id: string; text: string; comment?: string };

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
  sent?: ChatSentAttachment[];
  citations?: Citation[];
};

export type QueuedMessage = Outgoing;

/** A follow-up sent while a turn runs: queued for after it, or steering it. */
export type FollowUpBehavior = "queue" | "steer";

export type Device = { id: string; name: string };

/** An agent as `agent:providers` lists it; the runtime reads its kind, and asks the host if it's usable. */
export type AgentProvider = { kind: ProviderKind };

export type ChatsState = {
  conversations: Conversation[];
  ready: boolean;
  device: Device | null;
  activeId: string;
  docked: string[];
  activeTabs: Record<string, string>;
  watched: string | null;
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

/** What the chats need of the app around them. */
export interface ChatsHost<P extends AgentProvider = AgentProvider> {
  core: CoreBridge;
  platform: ClientPlatform;
  /** The agent's name for messages ("OpenClaw"), from its extension's manifest. */
  providerName(provider: ProviderKind): string;
  isProviderUsable(provider: P): boolean;
  /** A link in an answer is to a file the agent wrote (it opens as a tab). */
  isFileLink(href: string): boolean;
  mergeChanges(changes: ChatChange[]): ChatChange[];
  /** The chat was deleted: close the pages it opened. */
  closeChatPages(chatId: string): void;
  showError(title: string, description: string): void;
  log(event: string, data?: Record<string, unknown>): void;
}

const ACTIVE_KEY = "gmail:chat-active";
const ACTIVE_TABS_KEY = "gmail:chat-active-tabs";
const DOCKED_KEY = "gmail:chat-docked";
const MAX_DOCKED = 5;
const OPEN_REQUESTS_KEY = "gmail:chat-open-requests";

export function clampTitle(text: string): string {
  const t = text.trim();
  if (!t) return "New chat";
  return t.length > 56 ? `${t.slice(0, 56)}…` : t;
}

export const isBlank = (c: Conversation) => c.loaded && c.turns.length === 0;

export const isElsewhere = (c: Conversation, device: Device | null) =>
  LOCAL_CHAT_PROVIDERS.includes(c.provider) && c.device !== null && c.device.id !== device?.id;

/** Hydrated user turns show the question, not the context block sent with it. */
function stripHandoff(text: string): string {
  const cut = text.indexOf("\n\n— context from Otter Mail —");
  return cut === -1 ? text : text.slice(0, cut);
}

export function turnsFromMessages(messages: ChatSessionMessage[]): ChatTurn[] {
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

export function withTranscript(
  turns: ChatTurn[],
  requestId: string,
  messages: ChatSessionMessage[],
): ChatTurn[] {
  // A run the agent started itself has no message of ours: its turn starts the run.
  const own = turns.findIndex((t) => t.id === `a-${requestId}`);
  let at = turns.findIndex((t) => t.id === `u-${requestId}`);
  if (at < 0) at = own >= 0 ? own - 1 : turns.findLastIndex((t) => t.role === "user");
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
  return [...turns.slice(0, at + 1), ...next];
}

export function friendlyError(code: string, provider: ProviderKind, name: string): string {
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

type AgentRun = { provider: ProviderKind; sessionId: string; requestId: string };

export type ChatsStore<P extends AgentProvider = AgentProvider> = ReturnType<
  typeof makeChatsStore<P>
>;

/**
 * The agent's chats (synced through core: `chats:*`) and the runs streaming
 * in them (`agent:*`), as one atom. Turns stream from `agent:chatEvent`; a
 * message sent while a turn runs is queued for after it or steers it; runs the
 * agent starts itself (`agent:runStarted`, an OpenClaw continuation after a
 * yield) get a turn of their own, after the one running ends.
 */
export function makeChatsStore<P extends AgentProvider = AgentProvider>(
  registry: AtomRegistry.AtomRegistry,
  host: ChatsHost<P>,
) {
  const { core, platform } = host;
  const { storage } = platform;
  // Chats were kept here before they synced; they start over.
  storage.removeItem("gmail:hermes-chat:v2");
  storage.removeItem("gmail:panel-tabs");

  const newConversation = (provider: ProviderKind = "openrouter"): Conversation => {
    const now = Date.now();
    return {
      id: platform.newId(),
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
  };

  const stateAtom = Atom.make<ChatsState>({
    conversations: [],
    ready: false,
    device: null,
    activeId: storage.getItem(ACTIVE_KEY) ?? "",
    docked: readJson<string[]>(storage, DOCKED_KEY, []),
    activeTabs: readJson<Record<string, string>>(storage, ACTIVE_TABS_KEY, {}),
    watched: null,
    runs: {},
    unseen: new Set<string>(),
    approvals: [],
    questions: [],
    queue: [],
    editingQueued: null,
    hydrating: null,
    drafts: {},
    citations: {},
  }).pipe(Atom.keepAlive, Atom.withLabel("chats"));

  const get = () => registry.get(stateAtom);
  const listeners = new Set<(state: ChatsState, prev: ChatsState) => void>();
  const set = (patch: Partial<ChatsState> | ((s: ChatsState) => Partial<ChatsState>)) => {
    const prev = get();
    const next = typeof patch === "function" ? patch(prev) : patch;
    if (next === prev) return;
    const state = { ...prev, ...next };
    registry.set(stateAtom, state);
    for (const listener of listeners) listener(state, prev);
  };
  const subscribe = (listener: (state: ChatsState, prev: ChatsState) => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };

  const chatsApi = {
    list: () => core.invoke<{ chats: Omit<Chat, "turns">[]; device: Device }>("chats:list"),
    get: (id: string) => core.invoke<Chat | null>("chats:get", { id }),
    /** `settled`: no turn runs in it, so other devices can have it now (else in a while). */
    save: (chat: Chat, settled: boolean) => core.invoke<void>("chats:save", { chat, settled }),
    delete: (id: string) => core.invoke<void>("chats:delete", { id }),
  };

  const agent = {
    send: (params: {
      provider: ProviderKind;
      requestId: string;
      input: string;
      sessionId?: string;
      title?: string;
      skill?: { name: string; path?: string };
      attachments?: ChatAttachment[];
      previousResponseId?: string;
    }) => core.invoke<{ ok: boolean }>("agent:send", params),
    resume: (params: AgentRun) => core.invoke<{ resumed: boolean }>("agent:resume", params),
    notifyAsk: (params: {
      provider: ProviderKind;
      key: string;
      title: string;
      body?: string;
      focused: boolean;
    }) => core.invoke<{ ok: boolean }>("agent:notifyAsk", params),
    watch: (provider: ProviderKind, sessions: { id: string; since: number }[]) =>
      core.invoke<{ ok: boolean }>("agent:watch", { provider, sessions }),
    respondApproval: (params: {
      provider: ProviderKind;
      requestId: string;
      approvalId: string;
      decision: ApprovalDecision;
    }) => core.invoke<{ ok: boolean }>("agent:respondApproval", params),
    answerQuestion: (params: {
      provider: ProviderKind;
      requestId: string;
      questionId: string;
      answers: Record<string, string[]> | null;
    }) => core.invoke<{ ok: boolean }>("agent:answerQuestion", params),
    steer: (provider: ProviderKind, requestId: string, input: string) =>
      core.invoke<{ accepted: boolean }>("agent:steer", { provider, requestId, input }),
    cancel: (provider: ProviderKind, requestId: string) =>
      core.invoke<{ ok: boolean }>("agent:cancel", { provider, requestId }),
    sessionMessages: (provider: ProviderKind, sessionId: string) =>
      core.invoke<ChatSessionMessage[]>("agent:sessionMessages", { provider, sessionId }),
    deleteSession: (provider: ProviderKind, sessionId: string) =>
      core.invoke<{ ok: boolean }>("agent:deleteSession", { provider, sessionId }),
  };

  /** The turns in flight when the app last quit, read before anything writes the key again. */
  const savedOpenRequests = readJson<Record<string, string>>(storage, OPEN_REQUESTS_KEY, {});
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
          .catch((error: unknown) => host.log("save failed", { error: String(error) }))
          .finally(() => saving.delete(id));
      }, 1500),
    );
  }

  subscribe((state, prev) => {
    if (state.activeId !== prev.activeId) storage.setItem(ACTIVE_KEY, state.activeId);
    if (state.docked !== prev.docked) storage.setItem(DOCKED_KEY, JSON.stringify(state.docked));
    if (state.activeTabs !== prev.activeTabs)
      storage.setItem(ACTIVE_TABS_KEY, JSON.stringify(state.activeTabs));
    if (state.conversations === prev.conversations) return;
    const before = new Map(prev.conversations.map((c) => [c.id, c]));
    const open: Record<string, string> = {};
    for (const c of state.conversations) {
      if (c.openRequest) open[c.id] = c.openRequest;
      if (c === before.get(c.id) || fromCore.has(c) || !c.loaded || c.turns.length === 0) continue;
      scheduleSave(c.id);
    }
    storage.setItem(OPEN_REQUESTS_KEY, JSON.stringify(open));
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

  async function loadChat(id: string): Promise<void> {
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
      snoozedUntil: null,
      settledAt: null,
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
        openChatTab(
          convoId,
          { kind: "thread", accountId: target.accountId, id: target.id },
          title,
          {
            show: false,
          },
        );
    }
  }

  function startTurn(msg: Outgoing, intent?: ChatTurn["intent"]): void {
    const convo = get().conversations.find((c) => c.id === msg.convoId);
    if (!convo) return;
    const requestId = platform.newId();
    const firstTurn = convo.turns.length === 0;
    const kind = firstTurn ? msg.provider : convo.provider;
    host.log("send", {
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
        firstTurn && LOCAL_CHAT_PROVIDERS.includes(kind)
          ? get().device
          : firstTurn
            ? null
            : c.device,
      openRequest: requestId,
    }));
    appendExchange(msg.convoId, msg, requestId, intent);
    agent
      .send({
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
        host.log("send failed", { error: String(error) });
        patchConversation(msg.convoId, (c) => ({
          ...c,
          turns: c.turns.map((t) =>
            t.id === `a-${requestId}`
              ? {
                  ...t,
                  error: friendlyError("unreachable", kind, host.providerName(kind)),
                  finishedAt: Date.now(),
                }
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
    host.log("steer", { provider: target.provider, intent });
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
    agent
      .steer(target.provider, target.requestId, msg.input)
      .then(({ accepted }) => !accepted && refused(), refused);
  }

  function sendMessage(msg: Outgoing, followUp: FollowUpBehavior): void {
    if (!get().runs[msg.convoId]) return startTurn(msg);
    if (followUp === "queue" || msg.attachments) set((s) => ({ queue: [...s.queue, msg] }));
    else steer(msg);
  }

  function steerQueued(id: string): void {
    const msg = get().queue.find((m) => m.id === id);
    if (!msg || !get().runs[msg.convoId]) return;
    set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
    steer(msg, "promoted");
  }

  function moveQueued(id: string, beforeId: string | null): void {
    set((s) => {
      const moving = s.queue.find((m) => m.id === id);
      if (!moving || id === beforeId) return s;
      const rest = s.queue.filter((m) => m.id !== id);
      const at = beforeId === null ? rest.length : rest.findIndex((m) => m.id === beforeId);
      return at < 0 ? s : { queue: [...rest.slice(0, at), moving, ...rest.slice(at)] };
    });
  }

  function removeQueued(id: string): void {
    set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
  }

  function updateQueued(id: string, text: string): void {
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

  function setEditingQueued(id: string | null): void {
    if (get().editingQueued === id) return;
    set({ editingQueued: id });
    startQueued();
  }

  function stopRun(convoId: string): void {
    const run = get().runs[convoId];
    if (run) void agent.cancel(run.provider, run.requestId);
  }

  async function respondApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const { approvals, runs } = get();
    const pending = approvals.find((a) => a.approval.id === approvalId);
    const owner = pending && Object.values(runs).find((r) => r.requestId === pending.requestId);
    if (!owner) return;
    const { provider: kind, requestId } = owner;
    host.log("approval", { kind, decision });
    try {
      await agent.respondApproval({ provider: kind, requestId, approvalId, decision });
      set((s) => ({ approvals: s.approvals.filter((a) => a.approval.id !== approvalId) }));
    } catch (error) {
      host.log("approval failed", { error: String(error) });
    }
  }

  async function answerQuestion(
    questionId: string,
    answers: Record<string, string[]> | null,
  ): Promise<void> {
    const { questions, runs } = get();
    const pending = questions.find((q) => q.question.id === questionId);
    const owner = pending && Object.values(runs).find((r) => r.requestId === pending.requestId);
    if (!owner) return;
    host.log("question", { kind: owner.provider, skipped: answers === null });
    try {
      await agent.answerQuestion({
        provider: owner.provider,
        requestId: owner.requestId,
        questionId,
        answers,
      });
      set((s) => ({ questions: s.questions.filter((q) => q.question.id !== questionId) }));
    } catch (error) {
      host.log("question failed", { error: String(error) });
      host.showError(
        "Couldn't send the answer",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  function openChatTab(
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

  function showChatTab(convoId: string, tabId: string): void {
    set((s) => ({ activeTabs: { ...s.activeTabs, [convoId]: tabId } }));
  }

  function closeChatTab(convoId: string, tabId: string): void {
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

  function reorderChatTabs(convoId: string, order: string[]): void {
    patchConversation(convoId, (c) => ({
      ...c,
      tabs: [
        ...order.flatMap((id) => c.tabs.filter((t) => t.id === id)),
        ...c.tabs.filter((t) => !order.includes(t.id)),
      ],
      updatedAt: Date.now(),
    }));
  }

  function linkedFiles(text: string): { title: string; href: string }[] {
    return [...text.matchAll(/\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g)].flatMap(([, label, href]) =>
      host.isFileLink(href) && !href.startsWith("data:")
        ? [{ title: label.trim() || basename(href), href }]
        : [],
    );
  }

  function setDraft(convoId: string, text: string): void {
    set((s) => ({ drafts: { ...s.drafts, [convoId]: text } }));
  }

  function setCitations(convoId: string, update: (list: Citation[]) => Citation[]): void {
    set((s) => ({ citations: { ...s.citations, [convoId]: update(s.citations[convoId] ?? []) } }));
  }

  function showChat(id: string): void {
    set((s) => {
      if (!s.unseen.has(id)) return s.activeId === id ? s : { activeId: id };
      const unseen = new Set(s.unseen);
      unseen.delete(id);
      return { activeId: id, unseen };
    });
  }

  function dockChat(id: string): void {
    set((s) => (s.docked.includes(id) ? s : { docked: [...s.docked, id].slice(-MAX_DOCKED) }));
  }

  function undockChat(id: string): void {
    set((s) => (s.docked.includes(id) ? { docked: s.docked.filter((d) => d !== id) } : s));
  }

  function watchChat(id: string | null): void {
    set((s) => {
      if (!id || !s.unseen.has(id)) return s.watched === id ? s : { watched: id };
      const unseen = new Set(s.unseen);
      unseen.delete(id);
      return { watched: id, unseen };
    });
  }

  async function shelveChat(
    id: string,
    change: Pick<Chat, "snoozedUntil" | "settledAt">,
  ): Promise<void> {
    if (!get().conversations.find((c) => c.id === id)?.loaded) await loadChat(id);
    patchConversation(id, (c) => ({ ...c, ...change, updatedAt: Date.now() }));
  }

  function newChat(provider: ProviderKind): string {
    const blank = get().conversations.find(isBlank);
    if (blank) {
      if (blank.provider !== provider) patchConversation(blank.id, (c) => ({ ...c, provider }));
      showChat(blank.id);
      return blank.id;
    }
    host.log("newChat");
    const fresh = newConversation(provider);
    set((s) => ({ conversations: [fresh, ...s.conversations], activeId: fresh.id }));
    return fresh.id;
  }

  function deleteConversation(id: string, provider: ProviderKind): void {
    const running = get().runs[id];
    if (running) {
      void agent.cancel(running.provider, running.requestId);
      endRun(running.requestId);
    }
    const target = get().conversations.find((c) => c.id === id);
    if (!target) return;
    if (target.sessionId && target.sessionOwned) {
      void agent.deleteSession(target.provider, target.sessionId).catch(() => {});
    }
    if (!isBlank(target)) void chatsApi.delete(id).catch(() => {});
    host.closeChatPages(id);
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

  function openServerSession(session: ChatSession, provider: ProviderKind, providerName: string) {
    const existing = get().conversations.find(
      (c) => c.sessionId === session.id && c.provider === provider,
    );
    if (existing) {
      showChat(existing.id);
      return;
    }
    host.log("openServerSession", { provider, sessionId: session.id, source: session.source });
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
    agent
      .sessionMessages(provider, session.id)
      .then(
        (messages) => {
          const hydrated = turnsFromMessages(messages);
          patchConversation(convo.id, (c) =>
            c.turns.length > 0 ? c : { ...c, turns: hydrated, updatedAt: Date.now() },
          );
        },
        (error) => host.log("hydrate failed", { error: String(error) }),
      )
      .finally(() => set((s) => (s.hydrating === convo.id ? { hydrating: null } : s)));
  }

  const resumeTried = new Map<string, P>();

  /**
   * A turn the app quit during (or lost the connection in) is picked up
   * again: the provider shows how far its run got, then streams the rest.
   * Tried once per provider state, so a gateway that comes back retries it.
   */
  function resumeRuns(providers: readonly P[]): void {
    for (const c of get().conversations) {
      const requestId = c.openRequest;
      const provider = providers.find((p) => p.kind === c.provider);
      if (
        !requestId ||
        !c.sessionId ||
        get().runs[c.id] ||
        !provider ||
        !host.isProviderUsable(provider)
      )
        continue;
      if (resumeTried.get(requestId) === provider) continue;
      resumeTried.set(requestId, provider);
      host.log("resume", { provider: c.provider, requestId });
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
          const { resumed } = await agent.resume({ provider: c.provider, requestId, sessionId });
          if (!resumed) giveUp();
        } catch (error) {
          host.log("resume failed", { error: String(error) });
          endRun(requestId);
        }
      })();
    }
  }

  const watchedSessions = new Map<ProviderKind, string>();

  /** This device's chats with a session, so the provider can show runs the agent starts itself. */
  function watchSessions(providers: readonly P[]): void {
    const { conversations, device } = get();
    for (const provider of providers) {
      if (!host.isProviderUsable(provider)) continue;
      const sessions = conversations
        .filter((c) => c.provider === provider.kind && c.sessionId && !isElsewhere(c, device))
        .map((c) => ({
          id: c.sessionId!,
          // A turn in flight is picked up again with all it led to: nothing to catch up on.
          since: c.openRequest
            ? Number.MAX_SAFE_INTEGER
            : (c.turns.findLast((t) => t.finishedAt)?.finishedAt ?? c.updatedAt),
        }));
      const key = JSON.stringify(sessions);
      if (watchedSessions.get(provider.kind) === key) continue;
      watchedSessions.set(provider.kind, key);
      void agent.watch(provider.kind, sessions).catch(() => watchedSessions.delete(provider.kind));
    }
  }

  /** Runs that started while their chat had a turn going: followed once it ends. */
  const waitingRuns = new Map<string, AgentRun[]>();

  /** A run the agent started on its own (a completion it was woken for): a turn of its own, without a message. */
  async function followAgentRun(run: AgentRun): Promise<void> {
    const convo = get().conversations.find(
      (c) => c.provider === run.provider && c.sessionId === run.sessionId,
    );
    if (!convo) return;
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
    host.log("agentRun", { provider: run.provider, requestId: run.requestId });
    set((s) => ({
      runs: {
        ...s.runs,
        [convo.id]: { requestId: run.requestId, convoId: convo.id, provider: run.provider },
      },
    }));
    patchConversation(convo.id, (c) => ({
      ...c,
      turns: [
        ...c.turns,
        { id: turnId, role: "assistant", text: "", items: [], startedAt: Date.now() },
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
      const { resumed } = await agent.resume(run);
      if (!resumed) drop();
    } catch (error) {
      host.log("agentRun failed", { error: String(error) });
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
    const focused = platform.focus.isFocused();
    void agent.notifyAsk({ provider: run.provider, key, title, body, focused }).catch(() => {});
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
      patchConversation(s.convoId, (c) => ({
        ...c,
        turns: withTranscript(c.turns, event.requestId, event.messages),
        updatedAt: event.messages.length > 0 ? Date.now() : c.updatedAt,
      }));
      return;
    }
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
      const turn = nextTurns[nextTurns.length - 1];
      if (!turn || turn.role !== "assistant") return c;
      const items = [...(turn.items ?? [])];
      const updated: ChatTurn = { ...turn, items };
      const last = items[items.length - 1];
      if (event.type === "change") {
        updated.changes = host.mergeChanges([...(turn.changes ?? []), event.change]);
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
                  (event.id === undefined || t.id === undefined || t.id === event.id),
              );
        const step = items[index];
        if (step?.kind === "step") items[index] = { ...step, output: event.output };
      } else if (event.type === "error") {
        updated.error = friendlyError(event.message, s.provider, host.providerName(s.provider));
      }
      if (event.type === "done" || event.type === "error") {
        updated.finishedAt = Date.now();
        // A step whose result never came isn't running any more.
        items.forEach((item, i) => {
          if (item.kind === "step" && item.output === undefined) items[i] = { ...item, output: "" };
        });
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
    if (event.type === "steerReturned") {
      set((st) => ({
        queue: [
          {
            id: platform.newId(),
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

  /** Loads the chats and follows core's events for them; returns how to stop. */
  function start(): () => void {
    void loadChats().catch((error: unknown) => host.log("load failed", { error: String(error) }));
    const offs = [
      core.on("agent:chatEvent", onChatEvent),
      core.on("agent:runStarted", (params: unknown) => {
        const run = params as AgentRun | undefined;
        if (run?.provider && run.sessionId && run.requestId) void followAgentRun(run);
      }),
      core.on("chats:changed", (params: unknown) => {
        const ids = (params as { ids?: string[] } | undefined)?.ids ?? [];
        if (ids.length > 0 && ids.every((id) => saving.has(id))) return;
        reloadTimer ??= setTimeout(() => {
          reloadTimer = null;
          void loadChats().catch(() => {});
        }, 200);
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  /** Picks up turns left open, and watches sessions, with these agents; returns how to stop. */
  function followProviders(providers: readonly P[]): () => void {
    resumeRuns(providers);
    if (get().ready) watchSessions(providers);
    return subscribe((s, prev) => {
      if (s.conversations !== prev.conversations || s.runs !== prev.runs) resumeRuns(providers);
      if (s.ready && s.conversations !== prev.conversations) watchSessions(providers);
    });
  }

  return {
    stateAtom: stateAtom as Atom.Atom<ChatsState>,
    get,
    subscribe,
    start,
    followProviders,
    loadChat,
    sendMessage,
    steerQueued,
    moveQueued,
    removeQueued,
    updateQueued,
    setEditingQueued,
    stopRun,
    respondApproval,
    answerQuestion,
    openChatTab,
    showChatTab,
    closeChatTab,
    reorderChatTabs,
    setDraft,
    setCitations,
    showChat,
    dockChat,
    undockChat,
    watchChat,
    shelveChat,
    newChat,
    deleteConversation,
    openServerSession,
    resumeRuns,
  };
}
