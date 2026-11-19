import type {
  AliasMailbox,
  ImapSettings,
  MailCapabilities,
  MailProviderKind,
} from "@otter/contracts";
import type { AliasPictures } from "@otter/contracts/relay";

export interface MailAccount {
  id: string;
  email: string;
  name: string;
  /** Absent in accounts stored before IMAP: Gmail. */
  provider?: MailProviderKind;
  imap?: ImapSettings;
  /** What the mailbox can do; set by gmail:listAccounts, never stored. */
  capabilities?: MailCapabilities;
  picture?: string;
  displayName?: string;
  color?: string;
  /** Shown instead of `picture`, which Google's profile refresh rewrites; it never touches this. */
  customPicture?: string;
  signature?: string;
  signatureInGmail?: boolean;
  /** The other addresses it sends from (`capabilities.sendAs`); never its own. */
  sendAs?: string[];
  /** Those of `sendAs` shown as mailboxes of their own (IMAP). */
  aliasMailboxes?: AliasMailbox[];
  /** Pictures chosen for its alias mailboxes, kept by address (lower-cased) even while one is off. */
  aliasPictures?: AliasPictures;
  /** No usable Google sign-in; set by gmail:listAccounts, never stored. */
  signedOut?: boolean;
}

export interface MailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
  color?: { backgroundColor: string; textColor: string };
}

export interface MessageSummary {
  id: string;
  /** Owning account — populated on reads so combined (cross-account) views can route. */
  accountId?: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
  /** Absent where the summary doesn't carry it (Gmail's and Outlook's lists): the detail does. */
  cc?: string;
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
  /**
   * The addresses the server delivered this copy to, lower-cased (IMAP: the topmost
   * Original-Recipient, Delivered-To and X-Original-To). Never returned by store reads.
   */
  deliveredTo?: string[];
}

export interface MessageDetail extends MessageSummary {
  draftRevision?: string;
  bodyHtml: string | null;
  bodyText: string | null;
  bcc?: string;
  /** Reply-To: where the sender asked replies to go, instead of From. */
  replyTo?: string;
  attachments: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }[];
}

/** An outgoing attachment for compose/forward — base64 is standard (not url-safe). */
export interface ComposeAttachment {
  name: string;
  mimeType: string;
  size: number;
  base64: string;
}

export interface ContactSuggestion {
  name: string;
  email: string;
}

export const ALL_MAIL_LABEL_ID = "ALL_MAIL";

export interface SyncStatus {
  accountId: string;
  syncing: boolean;
  phase: "idle" | "labels" | "full" | "incremental";
  synced: number;
  total: number | null;
  lastSyncAt: number | null;
  fullSyncDone: boolean;
  error: string | null;
  signInNeeded: boolean;
  download: { done: number; total: number } | null;
  revision: number;
}

export interface ViewRule {
  accountId: string;
  allOf: string[];
  noneOf: string[];
}

export interface MailView {
  id: string;
  name: string;
  kind: "custom";
  rules: ViewRule[];
  icon?: string | null;
  color?: string | null;
}
