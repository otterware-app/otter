import { ipc, task } from "~/lib/ipc";
import type { AliasMailbox, ImapSettings } from "@otter/contracts";
import type { NotificationConnection } from "@otter/contracts/relay";
export type { ChatChange } from "@otter/contracts";
import type { AgentAccess, AgentTokens, ConnectedAgent } from "@otter/contracts/agent-tokens";
import type {
  AgentScheduledTasks,
  ChannelTarget,
  ScheduledTaskInput,
  TaskRun,
} from "@otter/contracts/scheduled";
import type {
  ComposeAttachment,
  ContactSuggestion,
  MailAccount,
  MailLabel,
  MessageSummary,
  MessageDetail,
  MailView,
  SyncStatus,
  ViewRule,
} from "./types";

export type ListMessagesParams = {
  accountId: string;
  labelIds?: string[];
  alias?: string;
  pageToken?: string;
  maxResults?: number;
};

export type ListMessagesResult = {
  messages: MessageSummary[];
  nextPageToken?: string;
};

export type SearchMessagesParams = {
  q: string;
  accountId?: string;
  labelId?: string;
  rules?: ViewRule[];
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
  withinDays?: number;
  pageToken?: string;
  maxResults?: number;
};

export type ListCombinedMessagesParams = {
  rules: ViewRule[];
  pageToken?: string;
  maxResults?: number;
};

export type CombinedCounts = { total: number; unread: number };

export type MailSearchResult = {
  messages: MessageSummary[];
  cursors?: Record<string, string | null>;
  estimate: number;
  offline?: boolean;
};

export type MailtoTarget = { to: string; cc: string; subject: string; body: string };

export type MailApp = { id: string; name: string; path: string };
export type MailAppsResult = { apps: MailApp[]; defaultId: string | null };

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
};
/** `{ selected?, [agent id]: its settings, name, avatar }`. */
export type AgentSettingsPatch = { selected?: AgentId } & {
  [id: string]: Record<string, string | boolean> | string | undefined;
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
  | { requestId: string; type: "change"; change: import("@otter/contracts").ChatChange }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "question"; question: ChatQuestion }
  | { requestId: string; type: "questionResolved"; questionId: string }
  /** The run so far from the provider's record: replaces what follows the turn's message. */
  | { requestId: string; type: "transcript"; messages: ChatSessionMessage[] }
  | { requestId: string; type: "steerReturned"; text: string }
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

export type ModifyMessageParams = {
  accountId: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ModifyThreadParams = {
  accountId: string;
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type SendMessageParams = {
  scheduledAt?: number;
  accountId: string;
  /** One of the mailbox's addresses (its own or `sendAs`); absent: its own. */
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  replyToMessageId?: string;
  attachments?: ComposeAttachment[];
  /** The composer's autosave session and draft: that draft is what's sent. */
  sessionKey?: string;
  draftId?: string;
};

export type SaveDraftParams = {
  accountId: string;
  draftId?: string;
  /** Stable per composer: the backend serializes its saves and remembers its
      draft id, so a timed-out first save never leads to a duplicate draft. */
  sessionKey?: string;
  /** The draft version this edit is based on: the backend refuses to
      overwrite a newer one (changed elsewhere) and reports a conflict. */
  expectMessageId?: string;
  expectRevision?: string;
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  attachments?: ComposeAttachment[];
};

export type SaveDraftResult =
  | { draftId: string; messageId?: string; threadId?: string; revision?: string }
  /** Edited elsewhere since `expectMessageId`: nothing was saved. */
  | { conflict: true; draftId: string; messageId: string; revision?: string }
  /** Sent or deleted elsewhere: nothing was saved. */
  | { gone: true; draftId: string };

export type GetAttachmentParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
};

export type GetAttachmentResult = { saved: boolean };

export type GetAttachmentDataParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
};

export type PickAttachmentsResult = { attachments: ComposeAttachment[]; error?: string };

export type AttachmentFileParams = {
  accountId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
};

export type UpdateAccountParams = {
  accountId: string;
  displayName?: string;
  color?: string;
  customPicture?: string;
  /** One alias mailbox's picture; "" removes it. */
  aliasPicture?: { address: string; picture: string };
  signature?: string;
  /** The IMAP mailbox's other addresses it sends from (`capabilities.sendAs === "device"`). */
  sendAs?: string[];
  aliasMailboxes?: AliasMailbox[];
};

export type NotificationsMode = "off" | "inbox" | "all";

export type SyncSettings = {
  syncIntervalSeconds: number;
  notificationsMode: NotificationsMode;
  launchAtLogin: boolean;
  dockBadgeEnabled: boolean;
  errorReports: boolean;
};

export type SaveViewParams = {
  id?: string;
  name: string;
  rules: ViewRule[];
  icon?: string | null;
  color?: string | null;
};

export type SettingsPane =
  | "general"
  | "appearance"
  | "keybindings"
  | "accounts"
  | "calendar"
  | "browser"
  | "agents"
  | "integrations"
  | "features"
  | "otter";
export type SettingsTarget = { pane?: SettingsPane; item?: string };

export type AddImapAccountParams = {
  email: string;
  name?: string;
  password: string;
  imap: ImapSettings;
};

export const mailApi = {
  notificationConnections: (): Promise<{
    connections: NotificationConnection[];
    providers: Record<string, boolean>;
  }> => ipc("otter:notificationConnections"),
  connectNotifications: (accountId: string): Promise<{ url: string } | { connected: true }> =>
    ipc("otter:connectNotifications", { accountId }),
  disconnectNotifications: (accountId: string): Promise<void> =>
    ipc("otter:disconnectNotifications", { accountId }),
  saveSupportReport: (contents: string, filename?: "Otter diagnostics.json") =>
    task<boolean>("support:saveReport", { contents, filename }),
  listAccounts: (): Promise<MailAccount[]> => ipc("gmail:listAccounts"),

  addAccount: (email?: string): Promise<MailAccount | null> =>
    ipc("gmail:addAccount", email ? { email } : undefined),
  refreshSignatures: (): Promise<void> => ipc("gmail:refreshSignatures"),
  cancelAddAccount: (): Promise<void> => ipc("gmail:cancelAddAccount"),
  addOutlookAccount: (email?: string): Promise<MailAccount | null> =>
    ipc("gmail:addOutlookAccount", email ? { email } : undefined),
  mailProviders: (): Promise<{ outlook: boolean }> => ipc("gmail:mailProviders"),

  discoverImap: (email: string): Promise<ImapSettings | null> =>
    ipc("gmail:discoverImap", { email }),
  addImapAccount: (params: AddImapAccountParams): Promise<MailAccount> =>
    ipc("gmail:addImapAccount", params),
  signInImap: (accountId: string, password: string): Promise<void> =>
    ipc("gmail:signInImap", { accountId, password }),

  removeAccount: (accountId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:removeAccount", { accountId }),

  updateAccount: (params: UpdateAccountParams): Promise<MailAccount> =>
    ipc("gmail:updateAccount", params),

  suggestSendAs: (accountId: string): Promise<string[]> =>
    ipc("gmail:suggestSendAs", { accountId }),

  listLabels: (accountId: string, alias?: string): Promise<MailLabel[]> =>
    ipc("gmail:listLabels", { accountId, alias }),

  createLabel: (accountId: string, name: string): Promise<MailLabel> =>
    ipc("gmail:createLabel", { accountId, name }),

  updateLabel: (params: {
    accountId: string;
    labelId: string;
    name?: string;
    color?: { backgroundColor: string; textColor: string };
  }): Promise<{ ok: boolean }> => ipc("gmail:updateLabel", params),

  deleteLabel: (accountId: string, labelId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteLabel", { accountId, labelId }),

  listMessages: (params: ListMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listMessages", params),

  listCombinedMessages: (params: ListCombinedMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:listCombinedMessages", params),

  gmailSearch: (params: {
    q: string;
    accountIds: string[];
    cursors?: Record<string, string | null>;
  }): Promise<MailSearchResult> => task("gmail:search", params),

  searchMessages: (params: SearchMessagesParams): Promise<ListMessagesResult> =>
    ipc("gmail:searchMessages", params),

  countCombinedMessages: (params: { rules: ViewRule[] }): Promise<CombinedCounts> =>
    ipc("gmail:countCombinedMessages", params),

  /** null: the mailbox no longer has it. */
  getMessage: (accountId: string, messageId: string): Promise<MessageDetail | null> =>
    ipc("gmail:getMessage", { accountId, messageId }),

  modifyMessage: (params: ModifyMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyMessage", params),

  trashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashMessage", { accountId, messageId }),

  getThread: (accountId: string, threadId: string, alias?: string): Promise<MessageSummary[]> =>
    ipc("gmail:getThread", { accountId, threadId, alias }),

  modifyThread: (params: ModifyThreadParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyThread", params),

  trashThread: (accountId: string, threadId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashThread", { accountId, threadId }),

  untrashThread: (accountId: string, threadId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:untrashThread", { accountId, threadId }),

  untrashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:untrashMessage", { accountId, messageId }),

  deleteThreadsForever: (accountId: string, threadIds: string[]): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteThreadsForever", { accountId, threadIds }),
  markLabelRead: (accountId: string, labelId: string): Promise<{ count: number }> =>
    ipc("gmail:markLabelRead", { accountId, labelId }),
  emptyFolder: (accountId: string, labelId: "SPAM" | "TRASH"): Promise<{ deleted: number }> =>
    task("gmail:emptyFolder", { accountId, labelId }),

  getUnsubscribe: (
    accountId: string,
    messageId: string,
    fromEmail: string,
  ): Promise<{
    method: "oneClick" | "mailto" | "web";
    target: string;
    unsubscribed: boolean;
  } | null> => ipc("gmail:getUnsubscribe", { accountId, messageId, fromEmail }),

  unsubscribe: (
    accountId: string,
    messageId: string,
  ): Promise<{ done: true } | { openUrl: string }> =>
    task("gmail:unsubscribe", { accountId, messageId }),

  listSchedules: (): Promise<import("@otter/contracts").MailSchedule[]> =>
    ipc("gmail:listSchedules"),
  cancelSchedule: (id: string): Promise<"cancelled" | "sent" | undefined> =>
    task("gmail:cancelSchedule", { id }),
  snoozeThread: (accountId: string, threadId: string, dueAt: number): Promise<void> =>
    task("gmail:snoozeThread", { accountId, threadId, dueAt }),
  sendMessage: (
    params: SendMessageParams,
  ): Promise<{ ok: boolean; pending?: boolean; uncertain?: boolean }> =>
    params.scheduledAt === undefined
      ? ipc("gmail:sendMessage", params)
      : task("gmail:scheduleMessage", params),

  saveDraft: (params: SaveDraftParams): Promise<SaveDraftResult> => ipc("gmail:saveDraft", params),

  getDraftVersion: (
    accountId: string,
    draftId: string,
  ): Promise<{ messageId: string | null; revision?: string | null }> =>
    ipc("gmail:getDraftVersion", { accountId, draftId }),

  loadDraftVersion: (
    accountId: string,
    draftId: string,
    messageId: string,
  ): Promise<MessageDetail> => ipc("gmail:loadDraftVersion", { accountId, draftId, messageId }),

  deleteDraft: (accountId: string, draftId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:deleteDraft", { accountId, draftId }),

  /** Deletes a composer's draft: by id when known, else whatever its session's
      saves created (even if that id never reached the renderer). */
  deleteSessionDraft: (
    accountId: string,
    sessionKey: string,
    draftId?: string,
  ): Promise<{ ok: boolean }> => ipc("gmail:deleteDraft", { accountId, sessionKey, draftId }),

  getDraftForMessage: (
    accountId: string,
    messageId: string,
    threadId?: string,
  ): Promise<{ draftId: string | null; gone?: true }> =>
    ipc("gmail:getDraftForMessage", { accountId, messageId, threadId }),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    task("gmail:getAttachment", params),

  getAttachmentData: (params: GetAttachmentDataParams): Promise<{ base64: string; size: number }> =>
    task("gmail:getAttachmentData", params),

  openComposeAttachment: (params: { name: string; base64: string }): Promise<{ ok: boolean }> =>
    ipc("gmail:openComposeAttachment", params),

  proxyImage: (url: string): Promise<{ dataUrl: string | null }> =>
    ipc("gmail:proxyImage", { url }),

  openAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    task("gmail:openAttachment", params),

  dragAttachment: (params: AttachmentFileParams): Promise<{ ok: boolean }> =>
    task("gmail:dragAttachment", params),

  pickAttachments: (existingBytes: number): Promise<PickAttachmentsResult> =>
    task("gmail:pickAttachments", { existingBytes }),

  suggestContacts: (params: { q: string; limit?: number }): Promise<ContactSuggestion[]> =>
    ipc("gmail:suggestContacts", params),

  syncAccount: (accountId: string): Promise<SyncStatus> => ipc("gmail:syncAccount", { accountId }),

  getSyncStatus: (accountId: string): Promise<SyncStatus> =>
    ipc("gmail:getSyncStatus", { accountId }),

  getSenderAvatar: (accountId: string, email: string): Promise<{ dataUrl: string | null }> =>
    ipc("gmail:getSenderAvatar", { accountId, email }),

  getSyncSettings: (): Promise<SyncSettings> => ipc("gmail:getSyncSettings"),

  setSyncSettings: (params: Partial<SyncSettings>): Promise<SyncSettings> =>
    ipc("gmail:setSyncSettings", params),

  listViews: (): Promise<MailView[]> => ipc("gmail:listViews"),

  saveView: (params: SaveViewParams): Promise<MailView> => ipc("gmail:saveView", params),

  deleteView: (viewId: string): Promise<{ ok: boolean }> => ipc("gmail:deleteView", { viewId }),

  openSettings: (target?: SettingsTarget): Promise<void> => ipc("window:openSettings", target),
  closeMainWindow: (): Promise<void> => ipc("window:closeMain"),
  openWindow: (href: string): Promise<void> => ipc("window:open", { href }),

  getSettingsTarget: (): Promise<SettingsTarget | null> => ipc("window:getSettingsTarget"),

  takePendingOpenMessage: (): Promise<{
    accountId: string;
    messageId: string;
    mailbox?: string;
  } | null> => ipc("window:takePendingOpenMessage"),

  takePendingMailto: (): Promise<MailtoTarget | null> => ipc("app:takePendingMailto"),

  getDefaultMailStatus: (): Promise<{ isDefault: boolean }> => ipc("app:getDefaultMailStatus"),

  setDefaultMailApp: (id?: string): Promise<{ ok: boolean }> =>
    ipc("app:setDefaultMailApp", id ? { id } : undefined),

  listMailApps: (): Promise<MailAppsResult> => ipc("app:listMailApps"),

  agentProviders: (): Promise<ProvidersState> => ipc("agent:providers"),

  /** Checks the agents again (one, given its id): their status and the models they offer. */
  refreshAgentProviders: (id?: AgentId): Promise<{ ok: boolean }> =>
    ipc("agent:refreshProviders", id ? { provider: id } : undefined),

  updateAgentSettings: (patch: AgentSettingsPatch): Promise<ProvidersState> =>
    ipc("agent:updateSettings", patch),

  /** Adds an agent of this kind, to set up on its page. */
  addAgent: (kind: ProviderKind): Promise<{ id: AgentId; state: ProvidersState }> =>
    ipc("agent:add", { kind }),

  removeAgent: (id: AgentId): Promise<ProvidersState> => ipc("agent:remove", { provider: id }),

  /**
   * Starts a turn and returns at once; it streams as `agent:chatEvent`.
   * Without `sessionId` the provider opens a session and reports it in a
   * `session` event; Hermes chats without one chain via `previousResponseId`.
   */
  agentSend: (params: {
    provider: ProviderKind;
    requestId: string;
    input: string;
    sessionId?: string;
    title?: string;
    skill?: { name: string; path?: string };
    attachments?: ChatAttachment[];
    previousResponseId?: string;
  }): Promise<{ ok: boolean }> => ipc("agent:send", params),

  agentResume: (params: {
    provider: ProviderKind;
    requestId: string;
    sessionId: string;
  }): Promise<{ resumed: boolean }> => ipc("agent:resume", params),

  /** The agent session this window has on screen while it's in front, or null: its iPhones aren't told of that chat. */
  agentWatching: (params: { window: string; session: string | null }): Promise<{ ok: boolean }> =>
    ipc("agent:watching", params),

  /** Notifies that an agent is waiting on the user (an approval, a question). */
  agentNotifyAsk: (params: {
    provider: ProviderKind;
    key: string;
    title: string;
    subtitle?: string;
    body?: string;
    chat?: string;
    focused: boolean;
  }): Promise<{ ok: boolean }> => ipc("agent:notifyAsk", params),

  /** Watches these chats' sessions for runs the agent starts itself; they arrive as `agent:runStarted`. */
  agentWatch: (
    provider: ProviderKind,
    sessions: { id: string; since: number; cursor?: string }[],
  ): Promise<{ ok: boolean }> => ipc("agent:watch", { provider, sessions }),

  agentStageAttachments: (
    items: { name: string; mime: string; bytes: Uint8Array }[],
  ): Promise<{ attachments: ChatAttachment[]; errors: string[] }> =>
    ipc("agent:stageAttachments", { items }),

  agentRespondApproval: (params: {
    provider: ProviderKind;
    requestId: string;
    approvalId: string;
    decision: ApprovalDecision;
  }): Promise<{ ok: boolean }> => ipc("agent:respondApproval", params),

  agentAnswerQuestion: (params: {
    provider: ProviderKind;
    requestId: string;
    questionId: string;
    answers: Record<string, string[]> | null;
  }): Promise<{ ok: boolean }> => ipc("agent:answerQuestion", params),

  agentSteer: (
    provider: ProviderKind,
    requestId: string,
    input: string,
  ): Promise<{ accepted: boolean }> => ipc("agent:steer", { provider, requestId, input }),

  agentCancel: (provider: ProviderKind, requestId: string): Promise<{ ok: boolean }> =>
    ipc("agent:cancel", { provider, requestId }),

  agentSkills: (provider: ProviderKind): Promise<Skill[]> => ipc("agent:skills", { provider }),

  /** Otter's own sessions, or with `everywhere` every one the agent has (`otherSessions`). */
  agentSessions: (provider: AgentId, limit = 40, everywhere = false): Promise<ChatSession[]> =>
    ipc("agent:sessions", { provider, limit, everywhere }),

  agentSessionMessages: (
    provider: ProviderKind,
    sessionId: string,
  ): Promise<ChatSessionMessage[]> => ipc("agent:sessionMessages", { provider, sessionId }),

  agentReadFile: (
    provider: ProviderKind,
    sessionId: string,
    href: string,
  ): Promise<{
    name: string;
    mimeType: string;
    data: string;
    size: number;
  }> => task("agent:readFile", { provider, sessionId, href }),

  agentFork: (
    provider: ProviderKind,
    sessionId: string,
    before?: { requestId?: string; fromEnd: number },
  ): Promise<string> => ipc("agent:fork", { provider, sessionId, before }),

  agentRetitle: (
    provider: ProviderKind,
    sessionId: string,
    name: { title: string } | { message: string },
  ): Promise<string | null> => ipc("agent:retitle", { provider, sessionId, ...name }),

  /** A call in the chat's session (a new one without): its events come as `agent:talkEvent`. */
  agentTalkStart: (
    provider: ProviderKind,
    sessionId: string | null,
  ): Promise<{ talkId: string; sessionId: string; inputRate: number; outputRate: number }> =>
    ipc("agent:talkStart", { provider, sessionId }),

  /** What the microphone heard: mono 16-bit PCM at the call's input rate, base64. */
  agentTalkAudio: (
    provider: ProviderKind,
    talkId: string,
    audio: string,
  ): Promise<{ ok: boolean }> => ipc("agent:talkAudio", { provider, talkId, audio }),

  agentTalkPlayed: (
    provider: ProviderKind,
    talkId: string,
    mark: string,
  ): Promise<{ ok: boolean }> => ipc("agent:talkPlayed", { provider, talkId, mark }),

  agentTalkEnd: (provider: ProviderKind, talkId: string): Promise<{ ok: boolean }> =>
    ipc("agent:talkEnd", { provider, talkId }),

  agentBrowserView: (
    provider: ProviderKind,
    sessionId: string,
    request: { width: number; height: number; except?: string },
  ): Promise<{ targetId: string; url: string | null; page?: string; profile?: string } | null> =>
    ipc("agent:browserView", { provider, sessionId, ...request }),

  agentBrowserInput: (
    provider: ProviderKind,
    input: {
      targetId: string;
      profile?: string;
      take?: boolean;
      seq?: number;
      events?: unknown[];
    },
  ): Promise<{ ok: boolean }> => ipc("agent:browserInput", { provider, ...input }),

  agentBrowserEvents: (
    provider: ProviderKind,
    request: { targetId: string; profile?: string; since?: number; run?: string; waitMs: number },
  ): Promise<{
    run: string;
    seq: number;
    dialog: { dialogType: string; message: string; defaultPrompt: string } | null;
    events: ({ type: string; seq: number } & Record<string, unknown>)[];
  } | null> => ipc("agent:browserEvents", { provider, ...request }),

  agentBrowserUpload: (
    provider: ProviderKind,
    upload: { targetId: string; profile?: string; files: { name: string; data: string }[] },
  ): Promise<{ ok: boolean }> => ipc("agent:browserUpload", { provider, ...upload }),

  agentDeleteSession: (provider: ProviderKind, sessionId: string): Promise<{ ok: boolean }> =>
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
};
