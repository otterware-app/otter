import { ipc, task } from "~/lib/ipc";
import type { ImapSettings } from "@otter-mail/contracts";
import type { NotificationConnection } from "@otter-mail/contracts/relay";
export type { ChatChange } from "@otter-mail/contracts";
import type { AgentAccess, AgentTokens, ConnectedAgent } from "@otter-mail/contracts/agent-tokens";
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

export type ProviderKind = string;

export const DEFAULT_AGENT = "openrouter";
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
/** T3 Code's runtime modes: how much an agent may do without asking. */
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
  selected: ProviderKind;
};
export type AgentSettingsPatch = { selected?: ProviderKind } & {
  [kind: string]: Record<string, string | boolean> | string | undefined;
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
  | { requestId: string; type: "text"; id: string; text: string }
  | { requestId: string; type: "tool"; id?: string; step: ToolStep }
  | { requestId: string; type: "toolResult"; id?: string; output: string }
  | { requestId: string; type: "change"; change: import("@otter-mail/contracts").ChatChange }
  | { requestId: string; type: "approval"; approval: ApprovalRequest }
  | { requestId: string; type: "approvalResolved"; approvalId: string }
  | { requestId: string; type: "question"; question: ChatQuestion }
  | { requestId: string; type: "questionResolved"; questionId: string }
  /** The run so far from the provider's record: replaces what follows the turn's message. */
  | { requestId: string; type: "transcript"; messages: ChatSessionMessage[] }
  | { requestId: string; type: "steerReturned"; text: string }
  | { requestId: string; type: "done"; responseId: string | null }
  | { requestId: string; type: "error"; message: string };

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
  signature?: string;
  /** The IMAP mailbox's other addresses it sends from (`capabilities.sendAs === "device"`). */
  sendAs?: string[];
};

export type NotificationsMode = "off" | "inbox" | "all";

export type SyncSettings = {
  syncIntervalSeconds: number;
  notificationsMode: NotificationsMode;
  launchAtLogin: boolean;
  dockBadgeEnabled: boolean;
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
  /** The browser (Mac): links, extensions, browsing data. */
  | "browser"
  /** Extensions, by kind: chat settings and the agents; services it connects; mail features. */
  | "agents"
  | "integrations"
  | "features"
  /** The Otter account page, opened from the user button at the bottom of the nav. */
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
  saveSupportReport: (contents: string, filename?: "Otter Mail diagnostics.json") =>
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
  /** Adds an IMAP mailbox once its login and SMTP work; rejects with a readable message. */
  addImapAccount: (params: AddImapAccountParams): Promise<MailAccount> =>
    ipc("gmail:addImapAccount", params),
  /** Signs an IMAP mailbox in on this device (its password never syncs). */
  signInImap: (accountId: string, password: string): Promise<void> =>
    ipc("gmail:signInImap", { accountId, password }),

  removeAccount: (accountId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:removeAccount", { accountId }),

  updateAccount: (params: UpdateAccountParams): Promise<MailAccount> =>
    ipc("gmail:updateAccount", params),

  listLabels: (accountId: string): Promise<MailLabel[]> => ipc("gmail:listLabels", { accountId }),

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

  getMessage: (accountId: string, messageId: string): Promise<MessageDetail> =>
    ipc("gmail:getMessage", { accountId, messageId }),

  modifyMessage: (params: ModifyMessageParams): Promise<{ ok: boolean }> =>
    ipc("gmail:modifyMessage", params),

  trashMessage: (accountId: string, messageId: string): Promise<{ ok: boolean }> =>
    ipc("gmail:trashMessage", { accountId, messageId }),

  getThread: (accountId: string, threadId: string): Promise<MessageSummary[]> =>
    ipc("gmail:getThread", { accountId, threadId }),

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

  listSchedules: (): Promise<import("@otter-mail/contracts").MailSchedule[]> =>
    ipc("gmail:listSchedules"),
  cancelSchedule: (id: string): Promise<void> => task("gmail:cancelSchedule", { id }),
  snoozeThread: (accountId: string, threadId: string, dueAt: number): Promise<void> =>
    task("gmail:snoozeThread", { accountId, threadId, dueAt }),
  sendMessage: (params: SendMessageParams): Promise<{ ok: boolean }> =>
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
  ): Promise<{ draftId: string | null }> =>
    ipc("gmail:getDraftForMessage", { accountId, messageId, threadId }),

  getAttachment: (params: GetAttachmentParams): Promise<GetAttachmentResult> =>
    task("gmail:getAttachment", params),

  getAttachmentData: (params: GetAttachmentDataParams): Promise<{ base64: string; size: number }> =>
    task("gmail:getAttachmentData", params),

  openComposeAttachment: (params: { name: string; base64: string }): Promise<{ ok: boolean }> =>
    ipc("gmail:openComposeAttachment", params),

  proxyImage: (url: string): Promise<{ dataUrl: string }> => ipc("gmail:proxyImage", { url }),

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

  getSettingsTarget: (): Promise<SettingsTarget | null> => ipc("window:getSettingsTarget"),

  takePendingOpenMessage: (): Promise<{ accountId: string; messageId: string } | null> =>
    ipc("window:takePendingOpenMessage"),

  takePendingMailto: (): Promise<MailtoTarget | null> => ipc("app:takePendingMailto"),

  getDefaultMailStatus: (): Promise<{ isDefault: boolean }> => ipc("app:getDefaultMailStatus"),

  setDefaultMailApp: (id?: string): Promise<{ ok: boolean }> =>
    ipc("app:setDefaultMailApp", id ? { id } : undefined),

  listMailApps: (): Promise<MailAppsResult> => ipc("app:listMailApps"),

  agentProviders: (): Promise<ProvidersState> => ipc("agent:providers"),

  refreshAgentProviders: (): Promise<{ ok: boolean }> => ipc("agent:refreshProviders"),

  updateAgentSettings: (patch: AgentSettingsPatch): Promise<ProvidersState> =>
    ipc("agent:updateSettings", patch),

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

  agentSessions: (provider: ProviderKind, limit = 40): Promise<ChatSession[]> =>
    ipc("agent:sessions", { provider, limit }),

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

  agentDeleteSession: (provider: ProviderKind, sessionId: string): Promise<{ ok: boolean }> =>
    ipc("agent:deleteSession", { provider, sessionId }),

  connectedAgents: (): Promise<AgentTokens<ConnectedAgent>> => ipc("mcp:listAgents"),
  addConnectedAgent: (name: string, access: AgentAccess): Promise<string> =>
    ipc("mcp:addAgent", { name, access }),
  setConnectedAgentAccess: (id: string, access: AgentAccess): Promise<void> =>
    ipc("mcp:setAgentAccess", { id, access }),
  removeConnectedAgent: (id: string): Promise<void> => ipc("mcp:removeAgent", { id }),
};
