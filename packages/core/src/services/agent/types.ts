import type { ChatDelivery } from "@otter/contracts/chats";
import type {
  AgentScheduledTasks,
  ChannelTarget,
  ScheduledTaskInput,
  TaskRun,
} from "@otter/contracts/scheduled";
export type ProviderKind = string;

export const DEFAULT_AGENT = "hermes";

export type ProviderState = "ready" | "warning" | "error" | "disabled";

export type ProviderAuth = {
  status: "authenticated" | "unauthenticated" | "unknown";
  label?: string;
  email?: string;
};

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
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: ProviderAuth;
  /** Epoch ms of the last check; null while the first check runs. */
  checkedAt: number | null;
  message?: string;
  models: ProviderModel[];
  model: string | null;
  sessions: boolean;
  /** Whether a chat can be forked from one of your messages (`ChatProvider.fork`). */
  forks: boolean;
  /** Its chats can be renamed on the agent, and titled again by its model. */
  titles: boolean;
  /** Whether a chat's browser can be watched live (`ChatProvider.browserView`). */
  liveBrowser: boolean;
  /** The agent's settings, plus what its `settingsView` adds (never its secrets). */
  settings: AgentSettingsView;
};

export type ProvidersState = {
  providers: ProviderSnapshot[];
  selected: ProviderKind;
};

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export const RUNTIME_MODES: readonly RuntimeMode[] = [
  "approval-required",
  "auto-accept-edits",
  "full-access",
];

export type ApprovalDecision = "once" | "session" | "always" | "deny";

export type ApprovalRequest = {
  id: string;
  kind: "command" | "fileChange" | "permission" | "tool";
  title: string;
  detail?: string;
  reason?: string;
  choices: ApprovalDecision[];
};

export type AgentSettings = {
  enabled: boolean;
  model: string;
  reasoningEffort?: string;
  serviceTier?: string;
  runtimeMode?: RuntimeMode;
};

export type AgentSettingsView = AgentSettings & Record<string, unknown>;

export type AgentSettingField = "string" | "boolean" | "runtimeMode";

export type ProviderSettings = {
  selected: ProviderKind;
  agents: Record<ProviderKind, AgentSettings>;
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
  /** A better name for the chat than its first message, from the provider. */
  | { requestId: string; type: "title"; title: string }
  | { requestId: string; type: "delta"; id?: string; text: string }
  /** An authoritative replacement for one assistant message. */
  | { requestId: string; type: "text"; id: string; text: string }
  /** `id` pairs a step with its result. */
  | { requestId: string; type: "tool"; id?: string; step: ToolStep }
  | { requestId: string; type: "toolResult"; id?: string; output: string }
  | { requestId: string; type: "change"; change: import("@otter/contracts").ChatChange }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "question"; question: ChatQuestion }
  | { requestId: string; type: "questionResolved"; questionId: string }
  /**
   * What the run has written so far, from the provider's own record: it
   * replaces what the panel shows after the turn's message (a run picked up
   * again after the app quit or lost its connection).
   */
  | { requestId: string; type: "transcript"; messages: ChatSessionMessage[] }
  /** A steer the agent didn't get to before finishing: send it as the next message. */
  | { requestId: string; type: "steerReturned"; text: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

export type Emit = (event: ChatEvent) => void;

export type Skill = {
  name: string;
  description: string;
  category: string | null;
  path?: string;
};

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

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  kind: "image" | "file";
};

export type SendTurnInput = {
  requestId: string;
  input: string;
  sessionId?: string;
  title?: string;
  skill?: { name: string; path?: string };
  attachments?: ChatAttachment[];
  /** Hermes chats without a session: chain via the Responses API. */
  previousResponseId?: string;
};

export type ResumeTurnInput = { requestId: string; sessionId: string };

/**
 * A chat whose session is watched for runs the agent starts itself; `since` is when its last turn
 * ended, `cursor` where its session was last read up to (the gateway's, for those that have one).
 */
export type WatchedSession = { id: string; since: number; cursor?: string };

/**
 * A run the agent started on its own in a watched session: followed with `resume` under `requestId`.
 * `chat` when the session has no chat yet (what an agent delivered to Otter): start one, so titled.
 */
export type AgentRun = {
  sessionId: string;
  requestId: string;
  chat?: { title: string };
  /** When what an agent delivered was written, so only what's new notifies. */
  deliveredAt?: number;
  /** What it delivered: an automation's result, or a message it sent. */
  delivery?: ChatDelivery;
};

/** One of your messages in a session: the one sent with `requestId`, else the `fromEnd`th from the last (0). */
export type ForkPoint = { requestId?: string; fromEnd: number };

/**
 * A live view of the tab a session's agent browses in: `url` is a WebSocket of JPEG frames
 * (OpenClaw's screencast), null when that tab is still `except`.
 */
export type BrowserView = {
  targetId: string;
  url: string | null;
  page?: string;
  profile?: string;
};

/**
 * Your input to the agent's tab, once you've taken control (`take`; false hands it back):
 * mouse, wheel and key events in page CSS px, numbered in the order they were sent.
 */
export type BrowserInput = {
  targetId: string;
  profile?: string;
  take?: boolean;
  seq?: number;
  events?: Record<string, unknown>[];
};

/**
 * What happened on the agent's tab since `since` (absent: just where things are up to), waited
 * for up to `waitMs`: where the pointer went, the field typed in, pop-ups, file pickers, copies.
 */
export type BrowserEvents = {
  /** The plugin's run: its numbers start over with a new one. */
  run: string;
  seq: number;
  dialog: { dialogType: string; message: string; defaultPrompt: string } | null;
  events: Record<string, unknown>[];
};

export type BrowserViewRequest = { width: number; height: number; except?: string };

/** The tasks an agent runs on its own schedule (OpenClaw's automations, Hermes's jobs). */
export interface ScheduleSupport<S> {
  /** Null when the agent isn't set up on this device: it isn't listed. */
  list(settings: S): Promise<Omit<AgentScheduledTasks, "provider"> | null>;
  /** A new task when `id` is null. Its id. */
  save(settings: S, id: string | null, input: ScheduledTaskInput): Promise<string>;
  setEnabled(settings: S, id: string, enabled: boolean): Promise<void>;
  runNow(settings: S, id: string): Promise<void>;
  remove(settings: S, id: string): Promise<void>;
  runs?(settings: S, id: string, limit: number): Promise<TaskRun[]>;
  runTranscript?(settings: S, id: string, runId: string): Promise<ChatSessionMessage[]>;
  /** Who results could go to on one of its channels, for its agent `agent`. */
  targets?(settings: S, agent: string, channel: string): Promise<ChannelTarget[]>;
}

export interface ChatProvider<S extends AgentSettings = AgentSettings> {
  readonly kind: ProviderKind;
  readonly displayName: string;
  readonly defaults: S;
  readonly fields: { [K in keyof S]?: AgentSettingField };
  readonly deviceFields?: readonly (keyof S)[];
  readonly restartFields?: readonly (keyof S)[];
  readonly strictModels?: boolean;
  /** Settings that never follow the account (OpenClaw's pairing is this device's). */
  readonly localOnly?: boolean;
  /** What the settings form needs beyond the settings: whether a key is saved, a pairing request. */
  settingsView?(settings: S): Promise<Record<string, unknown>>;
  checkStatus(
    settings: S,
  ): Promise<
    Omit<
      ProviderSnapshot,
      "checkedAt" | "enabled" | "settings" | "forks" | "titles" | "liveBrowser"
    >
  >;
  sendTurn(input: SendTurnInput, settings: S, emit: Emit): Promise<void>;
  /**
   * Picks up a run sent earlier with this request id, which the panel lost
   * (the app quit, the window closed): emits the run so far as a
   * `transcript`, then streams the rest like `sendTurn`. Errors `detached`
   * when the provider can't be reached (try again later), `not_received`
   * when the message never got there. Only providers whose runs outlive
   * the app have it.
   */
  resume?(input: ResumeTurnInput, settings: S, emit: Emit): Promise<void>;
  /**
   * Watches these chats' sessions (replacing the last list) for runs no turn
   * started: a completion the agent was woken for, a scheduled job. Each is
   * reported once, and those since a chat's `since` are caught up on.
   */
  watch?(
    settings: S,
    sessions: WatchedSession[],
    started: (run: AgentRun) => void,
    /** A session was read up to `cursor`: the chat keeps it, and is read from there next. */
    read?: (sessionId: string, cursor: string) => void,
  ): void;
  /**
   * The agent's gateway says it delivered something to Otter (relay.ts's `AgentPointer`): catch
   * up now, on `sessionKey` too when no chat has it yet.
   */
  delivered?(settings: S, sessionKey?: string): void;
  cancel(requestId: string): void;
  /** Adds a message to the running turn; false when it can't (then queue it). */
  steer(requestId: string, input: string): Promise<boolean>;
  respondApproval(requestId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  answerQuestion?(
    requestId: string,
    questionId: string,
    answers: Record<string, string[]> | null,
  ): Promise<void>;
  listSkills(settings: S): Promise<Skill[]>;
  listSessions(settings: S, limit: number): Promise<ChatSession[]>;
  readSession(settings: S, sessionId: string): Promise<ChatSessionMessage[]>;
  readFile?(settings: S, sessionId: string, href: string): Promise<ChatFile>;
  /**
   * Names the session: `title` as given, or one its model writes from `message`
   * (null when it has none).
   */
  retitle?(
    settings: S,
    sessionId: string,
    name: { title: string } | { message: string },
  ): Promise<string | null>;
  /** A new session with what came before this message, or all of it: its id. */
  fork?(settings: S, sessionId: string, before?: ForkPoint): Promise<string>;
  /** Null when the session hasn't browsed, or its browser has closed. */
  browserView?(
    settings: S,
    sessionId: string,
    request: BrowserViewRequest,
  ): Promise<BrowserView | null>;
  browserInput?(settings: S, input: BrowserInput): Promise<void>;
  browserEvents?(
    settings: S,
    request: {
      targetId: string;
      profile?: string;
      since?: number;
      run?: string;
      waitMs: number;
    },
  ): Promise<BrowserEvents>;
  /** The files you chose for the page's own file picker; none cancels it. */
  browserUpload?(
    settings: S,
    upload: { targetId: string; profile?: string; files: { name: string; data: string }[] },
  ): Promise<void>;
  deleteSession(settings: S, sessionId: string): Promise<void>;
  readonly schedules?: ScheduleSupport<S>;
  shutdown(): void;
}

export type ChatFile = { name: string; mimeType: string; data: string; size: number };
