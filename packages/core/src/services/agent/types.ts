export type ProviderKind = string;

export const DEFAULT_AGENT = "openrouter";

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
  /** Upstream provider behind an aggregating agent (Hermes: "OpenRouter"). */
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
  /** The agent's settings, plus what its `settingsView` adds (never its secrets). */
  settings: AgentSettingsView;
};

/** Everything the renderer needs for the provider picker and settings. */
export type ProvidersState = {
  providers: ProviderSnapshot[];
  selected: ProviderKind;
};

/** T3 Code's runtime modes: how much an agent may do without asking. */
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
  | { requestId: string; type: "delta"; id?: string; text: string }
  /** An authoritative replacement for one assistant message. */
  | { requestId: string; type: "text"; id: string; text: string }
  /** `id` pairs a step with its result. */
  | { requestId: string; type: "tool"; id?: string; step: ToolStep }
  | { requestId: string; type: "toolResult"; id?: string; output: string }
  | { requestId: string; type: "change"; change: import("@otter-mail/contracts").ChatChange }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "question"; question: ChatQuestion }
  /** Answered (here or elsewhere), skipped, or expired: the question is no longer asked. */
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

export interface ChatProvider<S extends AgentSettings = AgentSettings> {
  readonly kind: ProviderKind;
  readonly displayName: string;
  /** Settings before the user changes any. */
  readonly defaults: S;
  readonly fields: { [K in keyof S]?: AgentSettingField };
  readonly deviceFields?: readonly (keyof S)[];
  readonly restartFields?: readonly (keyof S)[];
  readonly strictModels?: boolean;
  /** Settings that never follow the account (OpenClaw's pairing is this device's). */
  readonly localOnly?: boolean;
  /** What the settings form needs beyond the settings: whether a key is saved, a pairing request. */
  settingsView?(settings: S): Promise<Record<string, unknown>>;
  checkStatus(settings: S): Promise<Omit<ProviderSnapshot, "checkedAt" | "enabled" | "settings">>;
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
  deleteSession(settings: S, sessionId: string): Promise<void>;
  shutdown(): void;
}

export type ChatFile = { name: string; mimeType: string; data: string; size: number };
