/**
 * Agent provider contracts shared by the backend and (mirrored in
 * apps/web/src/main/mail/api.ts) the renderer. Modelled on T3 Code's provider
 * layer: a *snapshot* describes a provider's health, a *provider* runs chat
 * turns, and every provider streams the same canonical {@link ChatEvent}s.
 */

/** An agent's id: its extension's (`openrouter`, `hermes`, `claude`, …). */
export type ProviderKind = string;

/** The agent new chats start with until the user picks another. */
export const DEFAULT_AGENT = "openrouter";

export type ProviderState = "ready" | "warning" | "error" | "disabled";

export type ProviderAuth = {
  status: "authenticated" | "unauthenticated" | "unknown";
  /** e.g. the connected provider or the Hermes model id. */
  label?: string;
  email?: string;
};

/** One choice of a model option (a reasoning effort, a service tier). */
export type ProviderOptionChoice = {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
};

/** A per-model option the composer offers, like T3's option descriptors. */
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
  /** An OpenClaw agent's picture (an https or data URL), else its emoji. */
  avatar?: string;
  emoji?: string;
};

/** Health snapshot of one provider, as shown in Settings and the composer. */
export type ProviderSnapshot = {
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  /** The CLI could be started / the server answered. */
  installed: boolean;
  version: string | null;
  status: ProviderState;
  auth: ProviderAuth;
  /** Epoch ms of the last check; null while the first check runs. */
  checkedAt: number | null;
  message?: string;
  models: ProviderModel[];
  /** Model new turns use (settings choice, else the provider default). */
  model: string | null;
  /** Chats persist on the provider and can be listed/resumed. */
  sessions: boolean;
  /** The agent's settings, plus what its `settingsView` adds (never its secrets). */
  settings: AgentSettingsView;
};

/** Everything the renderer needs for the provider picker and settings. */
export type ProvidersState = {
  providers: ProviderSnapshot[];
  /** Provider new chats start with. */
  selected: ProviderKind;
};

/** T3 Code's runtime modes: how much an agent may do without asking. */
export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export const RUNTIME_MODES: readonly RuntimeMode[] = [
  "approval-required",
  "auto-accept-edits",
  "full-access",
];

/** How the user answers an approval: once, for the rest of the chat, always, or no. */
export type ApprovalDecision = "once" | "session" | "always" | "deny";

/** An agent asking permission mid-turn (run a command, edit files, …). */
export type ApprovalRequest = {
  id: string;
  kind: "command" | "fileChange" | "permission" | "tool";
  title: string;
  /** The command / paths / tool input, shown verbatim. */
  detail?: string;
  reason?: string;
  choices: ApprovalDecision[];
};

/**
 * What every agent's settings have; each agent adds its own (Hermes' server,
 * Codex's binary). Stored per agent id in assistant-providers.json.
 */
export type AgentSettings = {
  enabled: boolean;
  /** Empty → the agent's default model. */
  model: string;
  /** Empty → the model's default effort. */
  reasoningEffort?: string;
  /** Empty / "default" → standard speed. */
  serviceTier?: string;
  runtimeMode?: RuntimeMode;
};

/** An agent's settings as the renderer sees them: its fields and what `settingsView` adds. */
export type AgentSettingsView = AgentSettings & Record<string, unknown>;

/** The kind of value each settings field the renderer may change holds, to check patches. */
export type AgentSettingField = "string" | "boolean" | "runtimeMode";

/** Every agent's settings, by agent id, and the one new chats start with. */
export type ProviderSettings = {
  selected: ProviderKind;
  agents: Record<ProviderKind, AgentSettings>;
};

/**
 * One step an agent took, described the same way whichever agent took it
 * (steps.ts), like Otter Code's canonical tool items: the chat shows
 * `title`, groups a `source`'s steps, and opens to `detail` and the output.
 */
export type ToolStep = {
  kind: "command" | "read" | "edit" | "search" | "web" | "skill" | "tool";
  /** What it did, in words: "Search mail", "Read Chris Google Accounts skill", "Ran git status". */
  title: string;
  /** Its input: the command, the path, the arguments as JSON. */
  detail?: string;
  /** The integration (MCP server) it came from: "Otter Mail", "Linear". */
  source?: string;
};

/**
 * The agent asking the user something mid-run (OpenClaw's `ask_user`): one
 * to three questions, each with options and room for an answer of their own.
 */
export type ChatQuestion = {
  id: string;
  questions: {
    id: string;
    header: string;
    question: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
    /** Asks for a secret, which only the agent's own app takes. */
    secret: boolean;
  }[];
  /** Epoch ms when it stops waiting. */
  expiresAt: number;
};

/** Canonical stream events, one contract for every provider. */
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
  /** Codex invokes skills by path. */
  path?: string;
};

/** A persisted provider-side chat (Hermes session / Codex thread). */
export type ChatSession = {
  id: string;
  title: string | null;
  source: string;
  /** Epoch ms. */
  lastActive: number;
  messageCount: number;
  preview: string | null;
};

/** One transcript row of a session, flattened for the panel. */
export type ChatSessionMessage = {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCalls?: ToolStep[];
};

/** A file attached to a turn, staged in the app's assistant-attachments folder. */
export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** The staged copy, in the app's files (`assistant-attachments/…`). */
  path: string;
  kind: "image" | "file";
};

export type SendTurnInput = {
  requestId: string;
  input: string;
  /** Provider-side session to continue; omitted → the provider starts one and emits `session`. */
  sessionId?: string;
  /** Title for a new session. */
  title?: string;
  skill?: { name: string; path?: string };
  attachments?: ChatAttachment[];
  /** Hermes chats without a session: chain via the Responses API. */
  previousResponseId?: string;
};

export type ResumeTurnInput = { requestId: string; sessionId: string };

/**
 * The agent contribution: an agent the chat UI drives. Every agent streams the
 * same {@link ChatEvent}s and the UI draws them; an agent brings only its
 * health, its turns and, on the renderer's side, its icon and settings form.
 * Optional methods are capabilities: the UI shows what an agent has.
 */
export interface ChatProvider<S extends AgentSettings = AgentSettings> {
  readonly kind: ProviderKind;
  readonly displayName: string;
  /** Settings before the user changes any. */
  readonly defaults: S;
  /** The fields `agent:updateSettings` may change, and their kind. */
  readonly fields: { [K in keyof S]?: AgentSettingField };
  /** Fields that stay on this device (paths on this computer); the rest follow the account. */
  readonly deviceFields?: readonly (keyof S)[];
  /** Fields whose change restarts the agent (a new binary, another server). */
  readonly restartFields?: readonly (keyof S)[];
  /** A chosen model it no longer lists falls back to its default (OpenRouter's catalog changes). */
  readonly strictModels?: boolean;
  /** Settings that never follow the account (OpenClaw's pairing is this device's). */
  readonly localOnly?: boolean;
  /** What the settings form needs beyond the settings: whether a key is saved, a pairing request. */
  settingsView?(settings: S): Promise<Record<string, unknown>>;
  checkStatus(settings: S): Promise<Omit<ProviderSnapshot, "checkedAt" | "enabled" | "settings">>;
  /** Runs one turn to completion, reporting progress through `emit`. */
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
  /** Answers an approval the turn is waiting on. */
  respondApproval(requestId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
  /** Answers a question the run asked (answers by question id); null skips it. */
  answerQuestion?(
    requestId: string,
    questionId: string,
    answers: Record<string, string[]> | null,
  ): Promise<void>;
  listSkills(settings: S): Promise<Skill[]>;
  listSessions(settings: S, limit: number): Promise<ChatSession[]>;
  readSession(settings: S, sessionId: string): Promise<ChatSessionMessage[]>;
  /** A file linked by the agent, read on the machine that owns the session. */
  readFile?(settings: S, sessionId: string, href: string): Promise<ChatFile>;
  deleteSession(settings: S, sessionId: string): Promise<void>;
  /** Stop background processes (settings changed, app quitting). */
  shutdown(): void;
}

export type ChatFile = { name: string; mimeType: string; data: string; size: number };
