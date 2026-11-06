import type { ImapSettings, MailCapabilities, MailProviderKind } from "@otter-mail/contracts";

/** The shapes core's mail handlers answer with, as the clients read them. */

export type MailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
  total?: number;
  color?: { backgroundColor: string; textColor: string };
};

/** A row of a list: one message, standing for its thread when the list is by conversation. */
export type MessageSummary = {
  id: string;
  /** Owning account, on reads, so combined views can route. */
  accountId?: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  to: string;
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
};

/** `gmail:listMessages`: a page of a list. */
export type ListMessagesResult = { messages: MessageSummary[]; nextPageToken?: string };

/** What the helpers read of a mailbox (`gmail:listAccounts`). */
export type MailboxInfo = {
  id: string;
  email: string;
  provider?: MailProviderKind;
  imap?: ImapSettings;
  capabilities?: MailCapabilities;
};
