import type { ImapSettings, MailCapabilities, MailProviderKind } from "@otter-mail/contracts";

export type MailAccount = {
  id: string;
  email: string;
  name: string;
  /** Absent in accounts stored before IMAP: Gmail. */
  provider?: MailProviderKind;
  imap?: ImapSettings;
  /** What the mailbox can do; gate UI on these, never on `provider`. */
  capabilities?: MailCapabilities;
  picture?: string;
  displayName?: string;
  color?: string;
  signature?: string;
  /** False while the signature is kept only here: this sign-in may not save it in Gmail. */
  signatureInGmail?: boolean;
  /** The other addresses it sends from (`capabilities.sendAs`); never its own. */
  sendAs?: string[];
  signedOut?: boolean;
};

export type MailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
  color?: { backgroundColor: string; textColor: string };
};

export type MessageSummary = {
  id: string;
  /** Owning account — populated on reads so combined (cross-account) views can route. */
  accountId?: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  starred: boolean;
  labelIds: string[];
  hasAttachments: boolean;
  threadCount?: number;
  threadUnread?: boolean;
  threadStarred?: boolean;
  threadLabelIds?: string[];
  /** RFC 2822 reply headers — captured on Gmail fetches and persisted, never returned by store reads. */
  messageIdHeader?: string;
  referencesHeader?: string;
};

/** An outgoing attachment for compose/forward — base64 is standard (not url-safe). */
export type ComposeAttachment = {
  key?: string;
  name: string;
  mimeType: string;
  size: number;
  base64: string;
};

export type ContactSuggestion = {
  name: string;
  email: string;
};

export type MessageDetail = MessageSummary & {
  draftRevision?: string;
  bodyHtml: string | null;
  bodyText: string | null;
  cc?: string;
  bcc?: string;
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId?: string;
  }[];
};

export type LabelSelection = {
  accountId: string;
  labelId: string;
};

export type ViewRule = {
  accountId: string;
  allOf: string[];
  noneOf: string[];
};

export type MailView = {
  id: string;
  name: string;
  kind: "custom";
  rules: ViewRule[];
  icon?: string | null;
  color?: string | null;
};

export type SyncStatus = {
  accountId: string;
  syncing: boolean;
  phase: "idle" | "labels" | "full" | "incremental";
  synced: number;
  total: number | null;
  lastSyncAt: number | null;
  fullSyncDone: boolean;
  error: string | null;
  /** Sync can't go on until the user signs in to the mailbox again (or enters its password). */
  signInNeeded: boolean;
  download: { done: number; total: number } | null;
  revision: number;
};
