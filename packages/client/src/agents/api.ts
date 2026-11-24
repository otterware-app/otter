import { ipc, task } from "../bridge.ts";
import type { ChatChange } from "@otter/contracts";
import type { AgentAccess, AgentTokens, ConnectedAgent } from "@otter/contracts/agent-tokens";
import type {
  AgentScheduledTasks,
  ChannelTarget,
  ScheduledTaskInput,
  TaskModels,
  TaskRun,
} from "@otter/contracts/scheduled";

export type { ChatChange };

/** A kind of agent, its extension's id: hermes, openclaw, claude… */
export type ProviderKind = string;
/** One agent you added: what chats, tasks and every agent call name (as `provider`). */
export type AgentId = string;
export type ProviderState = "ready" | "warning" | "error" | "disabled";
export type ProviderOptionChoice = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};
export type ProviderModelOption = {
  id: "reasoningEffort" | "serviceTier";
  label: string;
  choices: ProviderOptionChoice[];
};
export type ProviderModel = {
  slug: string;
  name: string;
  /** Upstream provider behind an aggregating agent (Hermes: "Anthropic"). */
  subProvider?: string;
  isDefault?: boolean;
  options?: ProviderModelOption[];
  avatar?: string;
  emoji?: string;
};
export type ProviderSnapshot = {
  id: AgentId;
  kind: ProviderKind;
  /** The name you gave it. */
  name: string;
  /** The picture you gave it (a data URL). */
  avatar: string | null;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: {
    status: "authenticated" | "unauthenticated" | "unknown";
    label?: string;
    email?: string;
  };
  /** Epoch ms of the last check; null while the first check runs. */
  checkedAt: number | null;
  message?: string;
  models: ProviderModel[];
  model: string | null;
  sessions: boolean;
  forks: boolean;
  titles: boolean;
  liveBrowser: boolean;
  /** Whether you can talk with it in a chat now. */
  talk?: boolean;
  /** Its sessions list only Otter's own unless asked for every one. */
  otherSessions: boolean;
  /** The agent's settings, plus what it adds for its settings form (never its secrets). */
  settings: AgentSettingsView;
};
export type AgentSettingsView = {
  enabled: boolean;
  model: string;
  reasoningEffort?: string;
  serviceTier?: string;
  runtimeMode?: RuntimeMode;
} & Record<string, unknown>;
export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export type ApprovalDecision = "once" | "session" | "always" | "deny";

export type ApprovalRequest = {
  id: string;
  kind: "command" | "fileChange" | "permission" | "tool";
  title: string;
  detail?: string;
  reason?: string;
  choices: ApprovalDecision[];
};
export type ProvidersState = {
  providers: ProviderSnapshot[];
  /** The agent new chats start with; null when none is added. */
  selected: AgentId | null;
  /** The kinds this device can add. */
  kinds: { kind: ProviderKind; name: string }[];
  /** The account's agents this device can't run (a Mac's Claude): what their chats are named by. */
  others: { id: AgentId; name: string; kind: ProviderKind }[];
};
/** `{ selected?, [agent id]: its settings, name, avatar }`. */
export type AgentSettingsPatch = { selected?: AgentId } & {
  [id: string]: Record<string, string | boolean | string[]> | string | undefined;
};

export type ToolStep = {
  kind: "command" | "read" | "edit" | "search" | "web" | "skill" | "tool";
  title: string;
  detail?: string;
  source?: string;
  compaction?: true;
};

export type ChatQuestion = {
  id: string;
  questions: {
    id: string;
    header: string;
    question: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
    secret: boolean;
  }[];
  /** Epoch ms when it stops waiting. */
  expiresAt: number;
};

export type ChatEvent =
  | { requestId: string; type: "session"; sessionId: string }
  | { requestId: string; type: "title"; title: string }
  | { requestId: string; type: "delta"; id?: string; text: string }
  | { requestId: string; type: "text"; id: string; text: string }
  | { requestId: string; type: "tool"; id?: string; step: ToolStep }
  | { requestId: string; type: "toolResult"; id?: string; output: string }
  | { requestId: string; type: "change"; change: ChatChange }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "question"; question: ChatQuestion }
  | { requestId: string; type: "questionResolved"; questionId: string }
  /** The run so far from the provider's record: replaces what follows the turn's message. */
  | { requestId: string; type: "transcript"; messages: ChatSessionMessage[] }
  | { requestId: string; type: "steerReturned"; text: string }
  /** Handed off (OpenClaw's yield): the subagents the turn waits on, by label when they have one; null once it works again. */
  | { requestId: string; type: "waiting"; subagents: (string | null)[] | null }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

export type TalkEvent =
  | { talkId: string; type: "ready" }
  | { talkId: string; type: "audio"; audio: string }
  | { talkId: string; type: "clear" }
  | { talkId: string; type: "mark"; name: string }
  | { talkId: string; type: "transcript"; role: "user" | "assistant"; text: string; final: boolean }
  | { talkId: string; type: "closed"; error?: string };

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  kind: "image" | "file";
};

export type Skill = { name: string; description: string; category: string | null; path?: string };

export type ChatSession = {
  id: string;
  title: string | null;
  source: string;
  /** Epoch ms. */
  lastActive: number;
  messageCount: number;
  preview: string | null;
};

export type ChatSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCalls?: ToolStep[];
};

export type AgentNotificationsMode = "off" | "needs-you" | "all";
export type AgentNoticeKind = "approval" | "question" | "message" | "finished";

/** A way in for a gateway to send to Otter (its plugin's token), named for the agent. */
export type AgentChannel = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export const agentApi = {
  providers: (): Promise<ProvidersState> => ipc("agent:providers"),

  /** Checks the agents again (one, given its id): their status and the models they offer. */
  refreshProviders: (id?: AgentId): Promise<{ ok: boolean }> =>
    ipc("agent:refreshProviders", id ? { provider: id } : undefined),

  updateSettings: (patch: AgentSettingsPatch): Promise<ProvidersState> =>
    ipc("agent:updateSettings", patch),

  /** Adds an agent of this kind, to set up on its page. */
  add: (kind: ProviderKind): Promise<{ id: AgentId; state: ProvidersState }> =>
    ipc("agent:add", { kind }),

  remove: (id: AgentId): Promise<ProvidersState> => ipc("agent:remove", { provider: id }),

  /**
   * Starts a turn and returns at once; it streams as `agent:chatEvent`.
   * Without `sessionId` the provider opens a session and reports it in a
   * `session` event; Hermes chats without one chain via `previousResponseId`.
   */
  send: (params: {
    provider: ProviderKind;
    requestId: string;
    input: string;
    sessionId?: string;
    title?: string;
    skill?: { name: string; path?: string };
    attachments?: ChatAttachment[];
    previousResponseId?: string;
  }): Promise<{ ok: boolean }> => ipc("agent:send", params),

  resume: (params: {
    provider: ProviderKind;
    requestId: string;
    sessionId: string;
  }): Promise<{ resumed: boolean }> => ipc("agent:resume", params),

  /** The agent session this window has on screen while it's in front, or null: its iPhones aren't told of that chat. */
  watching: (params: { window: string; session: string | null }): Promise<{ ok: boolean }> =>
    ipc("agent:watching", params),

  /** Reports whether the user is active in this web tab, so iPhones stay quiet while working here. */
  presence: (params: { window: string; active: boolean }): Promise<{ ok: boolean }> =>
    ipc("agent:presence", params),

  /** Tells the relay this device sent a message in `session`, so replies follow back to it. */
  noteSent: (session: string): Promise<{ ok: boolean }> => ipc("agent:noteSent", { session }),

  /** Tells the relay an approval or question in `session` was answered here, cancelling queued phone escalation. */
  noteResolved: (session: string, id?: string): Promise<{ ok: boolean }> =>
    ipc("agent:noteResolved", { session, id }),

  /** Notifies that an agent is waiting on the user, delivered a message, or finished a run. */
  notifyAsk: (params: {
    provider: ProviderKind;
    key: string;
    kind: AgentNoticeKind;
    title: string;
    body?: string;
    chat?: string;
    chatTitle?: string;
    taskName?: string;
    options?: string[];
    /** An OpenClaw gateway's agent the chat is with. */
    persona?: string;
    /** The agent's kind's mark (SVG). */
    mark?: string;
    viewing: boolean;
    appFocused: boolean;
  }): Promise<{ ok: boolean }> => ipc("agent:notifyAsk", params),

  /** Closes stale OS notifications for an ask or chat. */
  dismissNotification: (params: { id?: string; chat?: string }): Promise<{ ok: boolean }> =>
    ipc("agent:dismissNotification", params),

  /** Watches these chats' sessions for runs the agent starts itself; they arrive as `agent:runStarted`. */
  watch: (
    provider: ProviderKind,
    sessions: { id: string; since: number; cursor?: string }[],
  ): Promise<{ ok: boolean }> => ipc("agent:watch", { provider, sessions }),

  /** A push was tapped for a session with no chat here yet: the agents catch up on it, making its chat. */
  delivered: (sessionKey: string): Promise<{ ok: boolean }> =>
    ipc("agent:delivered", { sessionKey }),

  stageAttachments: (
    items: { name: string; mime: string; bytes: Uint8Array }[],
  ): Promise<{ attachments: ChatAttachment[]; errors: string[] }> =>
    ipc("agent:stageAttachments", { items }),

  respondApproval: (params: {
    provider: ProviderKind;
    requestId: string;
    approvalId: string;
    decision: ApprovalDecision;
  }): Promise<{ ok: boolean }> => ipc("agent:respondApproval", params),

  answerQuestion: (params: {
    provider: ProviderKind;
    requestId: string;
    questionId: string;
    answers: Record<string, string[]> | null;
  }): Promise<{ ok: boolean }> => ipc("agent:answerQuestion", params),

  steer: (
    provider: ProviderKind,
    requestId: string,
    input: string,
  ): Promise<{ accepted: boolean }> => ipc("agent:steer", { provider, requestId, input }),

  cancel: (provider: ProviderKind, requestId: string): Promise<{ ok: boolean }> =>
    ipc("agent:cancel", { provider, requestId }),

  skills: (provider: ProviderKind): Promise<Skill[]> => ipc("agent:skills", { provider }),

  /** Otter's own sessions, or with `everywhere` every one the agent has (`otherSessions`). */
  sessions: (provider: AgentId, limit = 40, everywhere = false): Promise<ChatSession[]> =>
    ipc("agent:sessions", { provider, limit, everywhere }),

  sessionMessages: (provider: ProviderKind, sessionId: string): Promise<ChatSessionMessage[]> =>
    ipc("agent:sessionMessages", { provider, sessionId }),

  readFile: (
    provider: ProviderKind,
    sessionId: string,
    href: string,
  ): Promise<{
    name: string;
    mimeType: string;
    data: string;
    size: number;
  }> => task("agent:readFile", { provider, sessionId, href }),

  fork: (
    provider: ProviderKind,
    sessionId: string,
    before?: { requestId?: string; fromEnd: number },
  ): Promise<string> => ipc("agent:fork", { provider, sessionId, before }),

  retitle: (
    provider: ProviderKind,
    sessionId: string,
    name: { title: string } | { message: string },
  ): Promise<string | null> => ipc("agent:retitle", { provider, sessionId, ...name }),

  /** A call in the chat's session (a new one without): its events come as `agent:talkEvent`. */
  talkStart: (
    provider: ProviderKind,
    sessionId: string | null,
  ): Promise<{ talkId: string; sessionId: string; inputRate: number; outputRate: number }> =>
    ipc("agent:talkStart", { provider, sessionId }),

  /** What the microphone heard: mono 16-bit PCM at the call's input rate, base64. */
  talkAudio: (provider: ProviderKind, talkId: string, audio: string): Promise<{ ok: boolean }> =>
    ipc("agent:talkAudio", { provider, talkId, audio }),

  talkPlayed: (provider: ProviderKind, talkId: string, mark: string): Promise<{ ok: boolean }> =>
    ipc("agent:talkPlayed", { provider, talkId, mark }),

  talkEnd: (provider: ProviderKind, talkId: string): Promise<{ ok: boolean }> =>
    ipc("agent:talkEnd", { provider, talkId }),

  browserView: (
    provider: ProviderKind,
    sessionId: string,
    request: { width: number; height: number; except?: string },
  ): Promise<{ targetId: string; url: string | null; page?: string; profile?: string } | null> =>
    ipc("agent:browserView", { provider, sessionId, ...request }),

  browserInput: (
    provider: ProviderKind,
    input: {
      targetId: string;
      profile?: string;
      take?: boolean;
      seq?: number;
      events?: unknown[];
    },
  ): Promise<{ ok: boolean }> => ipc("agent:browserInput", { provider, ...input }),

  browserEvents: (
    provider: ProviderKind,
    request: { targetId: string; profile?: string; since?: number; run?: string; waitMs: number },
  ): Promise<{
    run: string;
    seq: number;
    dialog: { dialogType: string; message: string; defaultPrompt: string } | null;
    /** A field that takes typing has the focus. */
    field?: boolean;
    events: ({ type: string; seq: number } & Record<string, unknown>)[];
  } | null> => ipc("agent:browserEvents", { provider, ...request }),

  browserUpload: (
    provider: ProviderKind,
    upload: { targetId: string; profile?: string; files: { name: string; data: string }[] },
  ): Promise<{ ok: boolean }> => ipc("agent:browserUpload", { provider, ...upload }),

  deleteSession: (provider: ProviderKind, sessionId: string): Promise<{ ok: boolean }> =>
    ipc("agent:deleteSession", { provider, sessionId }),

  scheduledTasks: (): Promise<AgentScheduledTasks[]> => ipc("agent:scheduled"),
  saveScheduledTask: (
    provider: ProviderKind,
    id: string | null,
    task: ScheduledTaskInput,
  ): Promise<{ id: string }> => ipc("agent:saveScheduled", { provider, id, task }),
  setScheduledTaskEnabled: (
    provider: ProviderKind,
    id: string,
    enabled: boolean,
  ): Promise<{ ok: boolean }> => ipc("agent:setScheduledEnabled", { provider, id, enabled }),
  runScheduledTask: (provider: ProviderKind, id: string): Promise<{ ok: boolean }> =>
    ipc("agent:runScheduled", { provider, id }),
  deleteScheduledTask: (provider: ProviderKind, id: string): Promise<{ ok: boolean }> =>
    ipc("agent:deleteScheduled", { provider, id }),
  scheduledTaskRuns: (provider: ProviderKind, id: string, limit = 20): Promise<TaskRun[]> =>
    ipc("agent:scheduledRuns", { provider, id, limit }),
  scheduledTargets: (
    provider: ProviderKind,
    agent: string,
    channel: string,
  ): Promise<ChannelTarget[]> => ipc("agent:scheduledTargets", { provider, agent, channel }),
  scheduledModels: (provider: ProviderKind, agent: string): Promise<TaskModels> =>
    ipc("agent:scheduledModels", { provider, agent }),
  scheduledRunTranscript: (
    provider: ProviderKind,
    id: string,
    runId: string,
  ): Promise<ChatSessionMessage[]> => ipc("agent:scheduledRunTranscript", { provider, id, runId }),

  connectedAgents: (): Promise<AgentTokens<ConnectedAgent>> => ipc("mcp:listAgents"),
  addConnectedAgent: (name: string, access: AgentAccess): Promise<string> =>
    ipc("mcp:addAgent", { name, access }),
  setConnectedAgentAccess: (id: string, access: AgentAccess): Promise<void> =>
    ipc("mcp:setAgentAccess", { id, access }),
  removeConnectedAgent: (id: string): Promise<void> => ipc("mcp:removeAgent", { id }),

  channels: (): Promise<{ channels: AgentChannel[]; relayUrl: string }> => ipc("agent:channels"),
  /** Its token is shown only now. */
  makeChannel: (
    label: string,
  ): Promise<{ channel: AgentChannel; token: string; relayUrl: string }> =>
    ipc("agent:makeChannel", { label }),
  deleteChannel: (id: string): Promise<{ ok: boolean }> => ipc("agent:deleteChannel", { id }),
};
