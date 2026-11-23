import type { CalendarWatchResponse } from "@otter/contracts/relay";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { capabilitiesOf, findProvider, isSignedIn } from "../providers/index.js";
import {
  CalendarSyncExpired,
  NoCalendarAccess,
  type CalendarEvent,
  type CalendarInfo,
  type EventInput,
  type MailProvider,
} from "../providers/provider.js";
import type { MailAccount } from "../types.js";
import { listAccounts } from "./account-store.js";
import * as store from "./calendar-store.js";
import { generationOf, noteAllowed, noteRefused } from "./connections.js";
import { linkedAccountIds } from "./linked-accounts.js";
import { turnedOffMailboxes } from "./mail-sync.js";
import { getOtterUser, relayRequest } from "./otter-account.js";
import { getRealtimeState } from "./realtime.js";

/**
 * Keeps calendar-store.ts current: each calendar's events from three months back to a year
 * ahead, listed once, then only what changed (Google's sync tokens, Graph's delta). Ranges
 * past that are listed the first time they're asked for, and kept current the same way.
 * The relay tells us when a watched calendar changes; the rest is polled.
 */

export const CALENDAR_CHANGED = "calendar:changed";

type Calendar = NonNullable<MailProvider["calendar"]>;

export type AccountCalendars = {
  accountId: string;
  calendars: CalendarInfo[];
  /** Only the primary calendar: the sign-in may not list the others yet. */
  needsAccess?: boolean;
  error?: "noAccess" | "failed";
};

export type CalendarRange =
  | { accountId: string; calendarId: string; events: CalendarEvent[] }
  | { accountId: string; calendarId: string; error: "noAccess" | "failed"; message: string };

const TICK_MS = 60_000;
const POLL_MS = 3 * 60_000;
const PUSHED_POLL_MS = 15 * 60_000;
const LIST_STALE_MS = 15 * 60_000;
const ASKED_COOLDOWN_MS = 30_000;
const SETTLE_MS = 2_000;

const lastSyncAt = new Map<string, number>();
const running = new Map<string, Promise<void>>();
const rerun = new Set<string>();
const pushed = new Set<string>();
const soon = new Map<string, ReturnType<typeof setTimeout>>();
const covering = new Map<string, Promise<void>>();
const failures = new Map<string, { kind: "noAccess" | "failed"; message: string }>();
/** Events with a change of the user's on its way: sync leaves them to its answer. */
const holding = new Map<string, number>();
const watchTargets = new Map<string, CalendarWatchResponse>();
let timer: ReturnType<typeof setInterval> | null = null;

const key = (...parts: string[]) => parts.join("|");

function calendarOf(accountId: string): Calendar {
  const calendar = capabilitiesOf(accountId)?.calendar ? findProvider(accountId)?.calendar : null;
  if (!calendar) throw new Error(`${accountId} has no calendar.`);
  return calendar;
}

const background = <T>(accountId: string, run: () => Promise<T>): Promise<T> =>
  findProvider(accountId)?.background("sync", run) ?? run();

const syncable = (account: MailAccount) =>
  Boolean(capabilitiesOf(account)?.calendar) &&
  isSignedIn(account) &&
  !turnedOffMailboxes().has(account.email.toLowerCase());

const listeners = new Set<(accountId: string) => void>();

export function onCalendarChanged(listener: (accountId: string) => void): void {
  listeners.add(listener);
}

function changed(accountId: string) {
  broadcast(CALENDAR_CHANGED, { accountId });
  for (const listener of listeners) listener(accountId);
}

function startOfMonth(ms: number, months = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime();
}

/** The first window: the months around today. */
const defaultWindow = (now = Date.now()) => ({
  fromMs: startOfMonth(now, -3),
  toMs: startOfMonth(now, 13),
});

async function refreshList(accountId: string): Promise<store.StoredList | null> {
  const generation = generationOf(accountId);
  let list: store.StoredList;
  try {
    const calendars = await calendarOf(accountId).listCalendars(accountId);
    noteAllowed(accountId, "listCalendars", generation);
    list = { calendars, syncedAt: Date.now() };
  } catch (error) {
    if (!(error instanceof NoCalendarAccess)) {
      logger.failure("calendar-sync", `Couldn't list ${accountId}'s calendars`, error);
      return null;
    }
    noteRefused(accountId, "listCalendars", generation);
    const primary: CalendarInfo = {
      id: "primary",
      name: accountId,
      color: null,
      primary: true,
      writable: true,
      hiddenByDefault: false,
      meetings: null,
    };
    list = { calendars: [primary], needsAccess: true, syncedAt: Date.now() };
  }
  const before = store.getList(accountId);
  store.saveList(accountId, list);
  if (JSON.stringify({ ...before, syncedAt: 0 }) !== JSON.stringify({ ...list, syncedAt: 0 }))
    changed(accountId);
  return list;
}

/** Stored first: the network's answer, when it differs, comes as a change. */
export async function accountCalendars(accountId: string): Promise<AccountCalendars> {
  const stored = store.getList(accountId);
  const list = stored ?? (await refreshList(accountId));
  if (stored && Date.now() - stored.syncedAt > LIST_STALE_MS) syncAccountSoon(accountId, 0);
  if (!list) return { accountId, calendars: [], error: "failed" };
  return {
    accountId,
    calendars: list.calendars,
    ...(list.needsAccess ? { needsAccess: true } : {}),
  };
}

function noteFailure(accountId: string, calendarId: string, error: unknown) {
  failures.set(key(accountId, calendarId), {
    kind: error instanceof NoCalendarAccess ? "noAccess" : "failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

const held = (accountId: string, calendarId: string) => (id: string) =>
  holding.has(key(accountId, calendarId, id));

/** Lists a range whole, and keeps its token. */
async function listRange(
  accountId: string,
  calendarId: string,
  range: { fromMs: number; toMs: number },
): Promise<void> {
  const found = await calendarOf(accountId).syncEvents(accountId, calendarId, {
    from: new Date(range.fromMs).toISOString(),
    to: new Date(range.toMs).toISOString(),
    token: null,
  });
  store.replaceRange(
    accountId,
    calendarId,
    { ...range, token: found.token },
    found.events,
    held(accountId, calendarId),
  );
}

/** What the calendar holds of [fromMs, toMs) is listed: the months it lacks are, once. */
function cover(accountId: string, calendarId: string, fromMs: number, toMs: number): Promise<void> {
  const k = key(accountId, calendarId);
  const pending = covering.get(k);
  if (pending) return pending.then(() => cover(accountId, calendarId, fromMs, toMs));
  const segments = store.segmentsOf(accountId, calendarId);
  const first = segments[0];
  const last = segments[segments.length - 1];
  const missing: { fromMs: number; toMs: number }[] = [];
  if (!first || !last) {
    const window = defaultWindow();
    missing.push({
      fromMs: Math.min(window.fromMs, startOfMonth(fromMs)),
      toMs: Math.max(window.toMs, startOfMonth(toMs, 1)),
    });
  } else {
    if (fromMs < first.fromMs)
      missing.push({ fromMs: startOfMonth(fromMs, -1), toMs: first.fromMs });
    if (toMs > last.toMs) missing.push({ fromMs: last.toMs, toMs: startOfMonth(toMs, 2) });
  }
  if (!missing.length) return Promise.resolve();
  const work = (async () => {
    try {
      for (const range of missing) await listRange(accountId, calendarId, range);
      failures.delete(k);
      changed(accountId);
    } catch (error) {
      noteFailure(accountId, calendarId, error);
    }
  })().finally(() => covering.delete(k));
  covering.set(k, work);
  return work;
}

/** The calendars' events in [from, to), from the store; ranges never listed are, first. */
export async function eventsInRange(
  calendars: { accountId: string; calendarId: string }[],
  from: string,
  to: string,
): Promise<CalendarRange[]> {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return Promise.all(
    calendars.map(async ({ accountId, calendarId }): Promise<CalendarRange> => {
      try {
        await cover(accountId, calendarId, fromMs, toMs);
      } catch (error) {
        noteFailure(accountId, calendarId, error);
      }
      const failure = failures.get(key(accountId, calendarId));
      if (failure && !store.segmentsOf(accountId, calendarId).length)
        return { accountId, calendarId, error: failure.kind, message: failure.message };
      const events = store
        .eventsIn(accountId, calendarId, fromMs, toMs)
        .filter((e) => e.status !== "cancelled");
      return { accountId, calendarId, events };
    }),
  );
}

/** What changed in one calendar since its tokens; a token that's lapsed lists its range again. */
async function syncCalendar(accountId: string, calendarId: string): Promise<boolean> {
  const segments = store.segmentsOf(accountId, calendarId);
  if (!segments.length) {
    const window = defaultWindow();
    await cover(accountId, calendarId, window.fromMs, window.toMs);
    return false;
  }
  let any = false;
  for (const segment of segments) {
    if (!segment.token) {
      await listRange(accountId, calendarId, segment);
      any = true;
      continue;
    }
    try {
      const found = await calendarOf(accountId).syncEvents(accountId, calendarId, {
        from: new Date(segment.fromMs).toISOString(),
        to: new Date(segment.toMs).toISOString(),
        token: segment.token,
      });
      store.applyChanges(
        accountId,
        calendarId,
        found.events,
        found.removed,
        held(accountId, calendarId),
      );
      store.saveToken(accountId, calendarId, { ...segment, token: found.token });
      any ||= found.events.length > 0 || found.removed.length > 0;
    } catch (error) {
      if (!(error instanceof CalendarSyncExpired)) throw error;
      await listRange(accountId, calendarId, segment);
      any = true;
    }
  }
  failures.delete(key(accountId, calendarId));
  return any;
}

async function runSync(accountId: string): Promise<void> {
  let list = store.getList(accountId);
  if (!list || list.needsAccess || Date.now() - list.syncedAt > LIST_STALE_MS)
    list = (await refreshList(accountId)) ?? list;
  if (!list) return;
  let any = false;
  for (const calendar of list.calendars) {
    try {
      any = (await syncCalendar(accountId, calendar.id)) || any;
    } catch (error) {
      noteFailure(accountId, calendar.id, error);
      logger.info("calendar-sync", "A calendar didn't sync", {
        accountId,
        error: String(error).slice(0, 200),
      });
    }
  }
  if (any) changed(accountId);
  await watch(accountId, list.calendars).catch((err: unknown) =>
    logger.failure("calendar-sync", `Couldn't watch ${accountId}'s calendars`, err),
  );
}

/** Asks the relay where the provider should send the account's calendar changes, and has it. */
async function watch(accountId: string, calendars: CalendarInfo[]): Promise<void> {
  const email = accountId.toLowerCase();
  if (!getOtterUser() || !linkedAccountIds().has(email)) {
    pushed.delete(accountId);
    return;
  }
  let target = watchTargets.get(email);
  if (!target) {
    target = await relayRequest<CalendarWatchResponse>("POST", "/v1/calendar/watch", { email });
    watchTargets.set(email, target);
  }
  const watching = await calendarOf(accountId).watchEvents(
    accountId,
    calendars.map((c) => c.id),
    { notificationUrl: target.notificationUrl, token: target.token },
  );
  if (watching) pushed.add(accountId);
  else pushed.delete(accountId);
}

/** Syncs the account now, or once more after the sync running. */
export function syncCalendarAccount(accountId: string): Promise<void> {
  const current = running.get(accountId);
  if (current) {
    rerun.add(accountId);
    return current;
  }
  const work = background(accountId, () => runSync(accountId))
    .catch((err: unknown) => logger.failure("calendar-sync", `${accountId} didn't sync`, err))
    .finally(() => {
      running.delete(accountId);
      lastSyncAt.set(accountId, Date.now());
      if (rerun.delete(accountId)) void syncCalendarAccount(accountId);
    });
  running.set(accountId, work);
  return work;
}

/** After the user's own change: a recurring event's other days, a declined invitation leaving. */
export function syncAccountSoon(accountId: string, delay = SETTLE_MS): void {
  clearTimeout(soon.get(accountId));
  soon.set(
    accountId,
    setTimeout(() => {
      soon.delete(accountId);
      void syncCalendarAccount(accountId);
    }, delay),
  );
}

/** A change the relay passed on, by mailbox address. */
export async function calendarPushed(email: string): Promise<void> {
  for (const account of await listAccounts())
    if (account.email.toLowerCase() === email.toLowerCase() && syncable(account))
      void syncCalendarAccount(account.id);
}

/** Every account due: polled, or (`asked`, the calendar on screen) not synced for a moment. */
export async function syncDueCalendars(reason: "timer" | "asked" | "push"): Promise<void> {
  const live = getRealtimeState() === "live";
  for (const account of await listAccounts()) {
    if (!syncable(account)) continue;
    const since = Date.now() - (lastSyncAt.get(account.id) ?? 0);
    const due =
      reason === "push"
        ? true
        : reason === "asked"
          ? since > ASKED_COOLDOWN_MS
          : since > (live && pushed.has(account.id) ? PUSHED_POLL_MS : POLL_MS);
    if (due) void syncCalendarAccount(account.id);
  }
}

export function startCalendarSync(): void {
  void syncDueCalendars("timer");
  timer ??= setInterval(() => void syncDueCalendars("timer"), TICK_MS);
}

export async function forgetCalendarAccount(accountId: string): Promise<void> {
  clearTimeout(soon.get(accountId));
  soon.delete(accountId);
  pushed.delete(accountId);
  lastSyncAt.delete(accountId);
  await findProvider(accountId)
    ?.calendar?.stopWatchingEvents(accountId)
    .catch(() => {});
  store.removeAccount(accountId);
}

/**
 * A change of the user's to one event: shown at once (`shown`, null when it goes), then the
 * provider's answer; put back as it was when the provider refuses.
 */
export async function changeEvent<T extends CalendarEvent | void>(
  accountId: string,
  calendarId: string,
  eventId: string,
  shown: (before: CalendarEvent) => CalendarEvent | null,
  run: () => Promise<T>,
): Promise<T> {
  const k = key(accountId, calendarId, eventId);
  const before = store.getEvent(accountId, calendarId, eventId);
  holding.set(k, (holding.get(k) ?? 0) + 1);
  if (before) {
    const next = shown(before);
    if (next) store.putEvent(accountId, calendarId, next);
    else store.deleteEvent(accountId, calendarId, eventId);
    changed(accountId);
  }
  try {
    const done = await run();
    if (done) store.putEvent(accountId, calendarId, done);
    return done;
  } catch (err) {
    if (before) store.putEvent(accountId, calendarId, before);
    throw err;
  } finally {
    const left = (holding.get(k) ?? 1) - 1;
    if (left) holding.set(k, left);
    else holding.delete(k);
    changed(accountId);
    syncAccountSoon(accountId);
  }
}

export function addedEvent(accountId: string, calendarId: string, event: CalendarEvent): void {
  store.putEvent(accountId, calendarId, event);
  changed(accountId);
  syncAccountSoon(accountId);
}

/** An answer to an invitation, on every day of its series when `allEvents`. */
export function answeredSeries(
  accountId: string,
  calendarId: string,
  seriesId: string,
  response: CalendarEvent["response"],
): void {
  for (const event of store.seriesEvents(accountId, calendarId, seriesId))
    store.putEvent(accountId, calendarId, { ...event, response });
  changed(accountId);
}

/** An event as a patch leaves it, until the provider says. */
export function patched(event: CalendarEvent, patch: EventInput): CalendarEvent {
  const next = { ...event };
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.allDay !== undefined) next.allDay = patch.allDay;
  if (patch.start !== undefined) {
    next.start = patch.start;
    if (patch.end === undefined && !next.allDay) {
      const length = Date.parse(event.end) - Date.parse(event.start);
      if (length > 0) next.end = new Date(Date.parse(patch.start) + length).toISOString();
    }
  }
  if (patch.end !== undefined) next.end = patch.end;
  if (patch.location !== undefined) next.location = patch.location || null;
  if (patch.description !== undefined) next.description = patch.description || null;
  if (patch.attendees !== undefined)
    next.attendees = patch.attendees.map(
      (email) =>
        event.attendees.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? {
          email,
          response: "needsAction" as const,
        },
    );
  if (patch.videoCall === false) next.meetingLink = null;
  return next;
}
