/**
 * Where a mailbox's mail comes from. Handlers and the sync engine talk to a
 * MailProvider, never to Gmail, IMAP or Outlook themselves; everything above it (the
 * cache, lists, the UI) sees mail the same way: messages carrying labels
 * (contracts' mail.ts, docs/imap.md).
 *
 * Members only some providers have are optional; the UI gates on
 * `capabilities`, never on the provider.
 */

import type { MailCapabilities, MailProviderKind } from "@otter-mail/contracts";

import type {
  ComposeAttachment,
  MailLabel,
  MessageDetail,
  MessageSummary,
  SyncStatus,
} from "../types.js";

export interface SyncContext {
  update(patch: Partial<SyncStatus>): void;
  bumpRevision(): void;
  /** Throws a SyncCancelled once the account was removed; call before every cache write. */
  assertActive(): void;
  newMail(messages: MessageSummary[]): Promise<void>;
}

export type Lane = "sync" | "backfill" | "prefetch";

/** The account was removed while its sync ran: the run ends without writing. */
export class SyncCancelled extends Error {
  constructor(accountId: string) {
    super(`sync cancelled: ${accountId} was removed`);
  }
}

/** The sign-in may not use the calendar: invitations are answered by email instead. */
export class NoCalendarAccess extends Error {}

export type LabelChange = { addLabelIds?: string[]; removeLabelIds?: string[] };

export type OutgoingMail = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeAttachment[];
};

export type DraftSave = Omit<OutgoingMail, "inReplyTo" | "references"> & {
  draftId?: string;
  expectRevision?: string;
};

export class DraftChanged extends Error {}

export type RsvpResponse = "accepted" | "declined" | "tentative";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  organizer: string | null;
  attendees: { email: string; name?: string; response: RsvpResponse | "needsAction" }[];
  response: RsvpResponse | "needsAction" | null;
  meetingLink: string | null;
  htmlLink: string | null;
  recurring: boolean;
};

/** One of an account's calendars: its own, another it was given, or one it follows. */
export type CalendarInfo = {
  id: string;
  name: string;
  /** Its color in Google or Outlook, if it has one. */
  color: string | null;
  /** The account's default calendar. */
  primary: boolean;
  /** Its events can be added and changed (else they're only looked at). */
  writable: boolean;
  /** Turned off where it came from (Google's unchecked calendars). */
  hiddenByDefault: boolean;
};

/** Someone else's time taken: the title only where their calendar shows it. */
export type BusyBlock = { start: string; end: string; title: string | null };

export type EventInput = {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  timeZone?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  videoCall?: boolean;
};

export type ErrorKind = "rateLimit" | "network" | "notFound" | "auth";

export interface MailProvider {
  readonly kind: MailProviderKind;
  readonly capabilities: MailCapabilities;

  isSignedIn(accountId: string): boolean;
  /** What the status line says while it can't. */
  readonly signedOutMessage: string;
  removeAccount(accountId: string): Promise<void>;

  sync(accountId: string, ctx: SyncContext): Promise<void>;
  /**
   * Whether there's long work to do on the whole mailbox (Gmail: the first
   * sync, or re-reading it after the history feed expired). The engine runs
   * `backfill` for it in its own lane, so syncs keep bringing new mail.
   */
  needsBackfill?(accountId: string): boolean;
  /** Does that work; resolves once there's none left. Safe to stop and run again. */
  backfill?(accountId: string, ctx: SyncContext): Promise<void>;
  background<T>(lane: Lane, fn: () => Promise<T>): Promise<T>;
  isCoolingDown?(accountId: string): boolean;
  errorKind(err: unknown): ErrorKind | null;
  describeError(err: unknown): string;

  watchViaRelay?(accountId: string, topic: string): Promise<boolean>;
  /** Otherwise the device watches itself (IMAP IDLE): `onChange` on news; returns a stop. */
  watch?(accountId: string, onChange: () => void): () => void;

  listLabels(accountId: string): Promise<MailLabel[]>;
  getSummaries(accountId: string, messageIds: string[]): Promise<MessageSummary[]>;
  getMessage(accountId: string, messageId: string): Promise<MessageDetail>;
  getThread?(accountId: string, threadId: string): Promise<MessageDetail[]>;
  fetchAttachment(accountId: string, messageId: string, attachmentId: string): Promise<Uint8Array>;
  /** Message-ID and References, for replying to a message cached without them. */
  getReplyHeaders(
    accountId: string,
    messageId: string,
  ): Promise<{ messageIdHeader: string | null; referencesHeader: string | null }>;
  getUnsubscribeHeaders(
    accountId: string,
    messageId: string,
  ): Promise<{ listUnsubscribe: string; oneClick: boolean }>;
  listIds?(
    accountId: string,
    params: { labelIds?: string[]; pageToken?: string; maxResults?: number; spamTrash?: boolean },
  ): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** The server's own search (Gmail's operators). Without it, search reads the local index. */
  search?(
    accountId: string,
    q: string,
    pageToken: string | undefined,
    maxResults: number,
  ): Promise<{
    refs: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate: number;
  }>;

  modifyMessage(accountId: string, messageId: string, change: LabelChange): Promise<void>;
  modifyThread(accountId: string, threadId: string, change: LabelChange): Promise<void>;
  trashMessage(accountId: string, messageId: string): Promise<void>;
  trashThread(accountId: string, threadId: string): Promise<void>;
  untrashMessage(accountId: string, messageId: string): Promise<MessageSummary[]>;
  untrashThread(accountId: string, threadId: string): Promise<MessageSummary[]>;
  deleteForever(accountId: string, messageIds: string[]): Promise<void>;
  emptyFolder(accountId: string, labelId: "SPAM" | "TRASH", cachedIds: string[]): Promise<string[]>;

  createLabel(accountId: string, name: string): Promise<MailLabel>;
  updateLabel(
    accountId: string,
    params: {
      labelId: string;
      name?: string;
      color?: { backgroundColor: string; textColor: string };
    },
  ): Promise<void>;
  deleteLabel(accountId: string, labelId: string): Promise<void>;

  send(accountId: string, mail: OutgoingMail): Promise<{ messageId?: string }>;
  scheduleSend?(
    accountId: string,
    mail: OutgoingMail,
    sendAt: number,
  ): Promise<{ messageId: string }>;
  cancelScheduledSend?(accountId: string, messageId: string): Promise<boolean>;
  /** Sends a ready-made RFC 822 message (unsubscribe mail, invitation replies). */
  sendRaw(accountId: string, raw: string, threadId?: string): Promise<void>;

  saveDraft(
    accountId: string,
    draft: DraftSave,
  ): Promise<{ draftId: string; messageId?: string; threadId?: string; revision?: string }>;
  deleteDraft(accountId: string, draftId: string): Promise<{ messageId?: string }>;
  getDraftVersion(accountId: string, draftId: string): Promise<string | null>;
  getDraftRevision?(accountId: string, draftId: string): Promise<string | null>;
  findDraftId(accountId: string, messageId: string, threadId?: string): Promise<string | null>;

  readProfile?(accountId: string): Promise<{ name?: string; picture?: string }>;

  signatures?: {
    get(accountId: string, email: string): Promise<string>;
    set(accountId: string, email: string, html: string): Promise<string>;
  };

  /**
   * The account's calendar (`capabilities.calendar`): invitations answered in
   * place, and its events for the agents' tools. Every call throws
   * NoCalendarAccess when the sign-in may not use it. `notify` tells attendees.
   */
  calendar?: {
    findEvent(
      accountId: string,
      uid: string,
    ): Promise<{ response: RsvpResponse | "needsAction"; htmlLink: string | null } | null>;
    respond(accountId: string, uid: string, response: RsvpResponse): Promise<boolean>;
    /** Every calendar the account has (its default first). */
    listCalendars(accountId: string): Promise<CalendarInfo[]>;
    // Without a calendarId, the account's default calendar.
    listEvents(
      accountId: string,
      range: { from: string; to: string; query?: string; limit: number; calendarId?: string },
    ): Promise<CalendarEvent[]>;
    getEvent(accountId: string, eventId: string, calendarId?: string): Promise<CalendarEvent>;
    createEvent(
      accountId: string,
      input: EventInput,
      notify: boolean,
      calendarId?: string,
    ): Promise<CalendarEvent>;
    updateEvent(
      accountId: string,
      eventId: string,
      patch: EventInput,
      notify: boolean,
      calendarId?: string,
    ): Promise<CalendarEvent>;
    deleteEvent(
      accountId: string,
      eventId: string,
      notify: boolean,
      calendarId?: string,
    ): Promise<void>;
    respondToEvent(
      accountId: string,
      eventId: string,
      response: RsvpResponse,
      calendarId?: string,
    ): Promise<CalendarEvent>;
    /** Other people's busy times, by address; null where theirs can't be seen. */
    schedule(
      accountId: string,
      emails: string[],
      range: { from: string; to: string },
    ): Promise<Record<string, BusyBlock[] | null>>;
  };
}
