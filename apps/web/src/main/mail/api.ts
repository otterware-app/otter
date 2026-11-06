import { ipc, task } from "~/lib/ipc";
import type { AliasMailbox, ImapSettings } from "@otter-mail/contracts";
import type { NotificationConnection } from "@otter-mail/contracts/relay";
export type { ChatChange } from "@otter-mail/contracts";
export type {
  ApprovalDecision,
  ApprovalRequest,
  ChatAttachment,
  ChatEvent,
  ChatQuestion,
  ChatSession,
  ChatSessionMessage,
  Skill,
  ToolStep,
} from "@otter-mail/contracts/chats";
import type {
  ApprovalDecision,
  ChatAttachment,
  ChatSession,
  ChatSessionMessage,
  Skill,
} from "@otter-mail/contracts/chats";
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
export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export type ProvidersState = {
  providers: ProviderSnapshot[];
  selected: ProviderKind;
};
export type AgentSettingsPatch = { selected?: ProviderKind } & {
  [kind: string]: Record<string, string | boolean> | string | undefined;
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

export type TabDrag = {
  tab: { href: string; title: string; icon: string };
  grabX: number;
  grabY: number;
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
  /**
   * Window tab drags between windows (the main process follows the cursor).
   * `openTabWindow`: a window of its own for a tab pulled off the strip;
   * `carryWindow`: this window, its only tab dragged. Either follows
   * `carryTabWindow` until `dropTabWindow` (or `returnTabWindow`: back in the strip).
   */
  openTabWindow: (params: TabDrag): Promise<void> => ipc("window:openTab", params),
  carryWindow: (params: TabDrag): Promise<void> => ipc("window:carry", params),
  carryTabWindow: (): Promise<void> => ipc("window:carryTo"),
  dropTabWindow: (): Promise<void> => ipc("window:dropTab"),
  returnTabWindow: (): Promise<void> => ipc("window:returnTab"),

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

  /** Notifies that an agent is waiting on the user (an approval, a question). */
  agentNotifyAsk: (params: {
    provider: ProviderKind;
    key: string;
    title: string;
    body?: string;
    focused: boolean;
  }): Promise<{ ok: boolean }> => ipc("agent:notifyAsk", params),

  /** Watches these chats' sessions for runs the agent starts itself; they arrive as `agent:runStarted`. */
  agentWatch: (
    provider: ProviderKind,
    sessions: { id: string; since: number }[],
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
