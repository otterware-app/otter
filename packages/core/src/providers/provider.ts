/**
 * Where a mailbox's mail comes from. Handlers and the sync engine talk to a
 * MailProvider, never to Gmail, IMAP or Outlook themselves; everything above it (the
 * cache, lists, the UI) sees mail the same way: messages carrying labels
 * (contracts' mail.ts, docs/imap.md).
 *
 * Members only some providers have are optional; the UI gates on
 * `capabilities`, never on the provider.
 */

import type { MailCapabilities, MailProviderKind, MeetingService } from "@otter-mail/contracts";

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

export class SyncCancelled extends Error {
  constructor(accountId: string) {
    super(`sync cancelled: ${accountId} was removed`);
  }
}

export class NoCalendarAccess extends Error {}

export type LabelChange = { addLabelIds?: string[]; removeLabelIds?: string[] };

export type OutgoingMail = {
  /** One of the mailbox's other addresses (`sendAs`) to send from; absent: its own. */
  from?: string;
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

export type DraftSave = OutgoingMail & {
  draftId?: string;
  expectRevision?: string;
};

export class DraftChanged extends Error {}

/** A send that may have gone out: the request was made, its answer never came. */
export class SendUncertain extends Error {
  /** The draft that may have gone, when the send made one (Outlook). */
  readonly draftId?: string;

  constructor(options?: { cause?: unknown; draftId?: string }) {
    super("May have been sent — check Sent before sending again.", { cause: options?.cause });
    this.name = "SendUncertain";
    this.draftId = options?.draftId;
  }
}

export type ScheduleOutcome = "cancelled" | "sent";

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
  seriesId: string | null;
};

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export type RespondOptions = { allEvents?: boolean; comment?: string };

export type CalendarInfo = {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  writable: boolean;
  /** Turned off where it came from (Google's unchecked calendars). */
  hiddenByDefault: boolean;
  meetings: MeetingService | null;
};

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
  /** Adds the calendar's online meeting (Google Meet, Teams); false takes Meet off. */
  videoCall?: boolean;
  /** New events only: repeats from its start, without end. */
  repeat?: Repeat;
};

export type ErrorKind = "rateLimit" | "network" | "notFound" | "auth";

export interface MailProvider {
  readonly kind: MailProviderKind;
  readonly capabilities: MailCapabilities;

  isSignedIn(accountId: string): boolean;
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
  /** Sends a saved draft as `mail`, leaving no draft behind. Throws SendUncertain when it can't tell. */
  sendDraft(
    accountId: string,
    draftId: string,
    mail: OutgoingMail,
  ): Promise<{ messageId?: string }>;
  /** With a `draftId`, that draft becomes the held message. */
  scheduleSend?(
    accountId: string,
    mail: OutgoingMail,
    sendAt: number,
    draftId?: string,
  ): Promise<{ messageId: string }>;
  cancelScheduledSend?(accountId: string, messageId: string): Promise<ScheduleOutcome>;
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

  sendAs?(accountId: string, email: string): Promise<string[]>;

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
      options?: RespondOptions,
    ): Promise<CalendarEvent>;
    schedule(
      accountId: string,
      emails: string[],
      range: { from: string; to: string },
    ): Promise<Record<string, BusyBlock[] | null>>;
  };
}
