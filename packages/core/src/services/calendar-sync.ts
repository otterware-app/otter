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
 * Keeps calendar-store.ts current: each calendar's window, three months back to a year ahead
 * (wider once a view asks for more), is listed once, then only what changed is fetched
 * (Google's sync tokens, Graph's delta). The relay tells us when a watched calendar changes;
 * the rest is polled.
 *
 * A sync's answer is only kept when no change of the user's to that calendar started or ended
 * while it was on its way: otherwise it's dropped, token and all, and the calendar synced again.
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
const covering = new Map<string, Promise<boolean>>();
const failures = new Map<string, { kind: "noAccess" | "failed"; message: string }>();
/** Bumped when an account is removed: work it started writes nothing. */
const epochs = new Map<string, number>();
/** By calendar: the user's changes on their way, and a count of every one begun or ended. */
const editing = new Map<string, number>();
const edits = new Map<string, number>();
const watchTargets = new Map<string, CalendarWatchResponse>();
let timer: ReturnType<typeof setInterval> | null = null;

/** A sync's answer that came back stale: dropped. */
class Superseded extends Error {}

const key = (...parts: string[]) => parts.join("|");
const count = (map: Map<string, number>, k: string) => map.get(k) ?? 0;

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

/**
 * Throws Superseded when the account went (since `epoch`, by default now), or, for a calendar,
 * when the user changed it or a listing moved its window since (a delta for the old window
 * mustn't land on the new one).
 */
function guard(
  accountId: string,
  calendarId?: string,
  epoch = count(epochs, accountId),
): () => void {
  const k = calendarId === undefined ? null : key(accountId, calendarId);
  const edit = k ? count(edits, k) : 0;
  const bounds = (window: store.Window | null) => `${window?.fromMs}-${window?.toMs}`;
  const window = calendarId === undefined ? "" : bounds(store.windowOf(accountId, calendarId));
  return () => {
    if (count(epochs, accountId) !== epoch) throw new Superseded();
    if (!k || calendarId === undefined) return;
    if (count(editing, k) > 0 || count(edits, k) !== edit) throw new Superseded();
    if (bounds(store.windowOf(accountId, calendarId)) !== window) throw new Superseded();
  };
}

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

/** What every calendar keeps: the months around today. */
const defaultWindow = (now = Date.now()) => ({
  fromMs: startOfMonth(now, -3),
  toMs: startOfMonth(now, 13),
});

async function refreshList(accountId: string): Promise<store.StoredList | null> {
  const generation = generationOf(accountId);
  const check = guard(accountId);
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
  check();
  const before = store.getList(accountId);
  store.saveList(accountId, list);
  if (JSON.stringify({ ...before, syncedAt: 0 }) !== JSON.stringify({ ...list, syncedAt: 0 }))
    changed(accountId);
  return list;
}

/** Stored first: the network's answer, when it differs, comes as a change. */
export async function accountCalendars(accountId: string): Promise<AccountCalendars> {
  const stored = store.getList(accountId);
  const list = stored ?? (await refreshList(accountId).catch(() => null));
  if (stored && Date.now() - stored.syncedAt > LIST_STALE_MS) syncAccountSoon(accountId, 0);
  if (!list) return { accountId, calendars: [], error: "failed" };
  return {
    accountId,
    calendars: list.calendars,
    ...(list.needsAccess ? { needsAccess: true } : {}),
  };
}

/** Lists the window whole, and keeps its token. */
async function listWindow(
  accountId: string,
  calendarId: string,
  window: { fromMs: number; toMs: number },
  epoch?: number,
): Promise<void> {
  const check = guard(accountId, calendarId, epoch);
  const found = await calendarOf(accountId).syncEvents(accountId, calendarId, {
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.toMs).toISOString(),
    token: null,
  });
  check();
  store.replaceWindow(accountId, calendarId, { ...window, token: found.token }, found.events);
}

/**
 * Makes the calendar's window hold [fromMs, toMs), listing it again, wider, when it doesn't
 * yet (once: it's kept after). Answers whether it listed.
 */
function cover(
  accountId: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
  epoch = count(epochs, accountId),
): Promise<boolean> {
  if (count(epochs, accountId) !== epoch) return Promise.reject(new Superseded());
  const k = key(accountId, calendarId);
  const current = store.windowOf(accountId, calendarId);
  if (current && current.fromMs <= fromMs && current.toMs >= toMs) return Promise.resolve(false);
  const pending = covering.get(k);
  if (pending)
    return pending.then(
      () => cover(accountId, calendarId, fromMs, toMs, epoch),
      () => cover(accountId, calendarId, fromMs, toMs, epoch),
    );
  const base = current ?? defaultWindow();
  const wanted = {
    fromMs: fromMs < base.fromMs ? startOfMonth(fromMs, -1) : base.fromMs,
    toMs: toMs > base.toMs ? startOfMonth(toMs, 2) : base.toMs,
  };
  const work = listWindow(accountId, calendarId, wanted, epoch)
    .then(() => {
      failures.delete(k);
      changed(accountId);
      return true;
    })
    .finally(() => covering.delete(k));
  covering.set(k, work);
  return work;
}

function noteFailure(accountId: string, calendarId: string, error: unknown) {
  if (error instanceof Superseded) return;
  failures.set(key(accountId, calendarId), {
    kind: error instanceof NoCalendarAccess ? "noAccess" : "failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * The calendars' events in [from, to), from the store; a range past what it holds is listed
 * first. One that couldn't be is an error, asked again later.
 */
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
      const window = store.windowOf(accountId, calendarId);
      if (!window || window.fromMs > fromMs || window.toMs < toMs) {
        const failure = failures.get(key(accountId, calendarId)) ?? {
          kind: "failed" as const,
          message: "Not synced yet.",
        };
        return { accountId, calendarId, error: failure.kind, message: failure.message };
      }
      const events = store
        .eventsIn(accountId, calendarId, fromMs, toMs)
        .filter((e) => e.status !== "cancelled");
      return { accountId, calendarId, events };
    }),
  );
}

/** What changed in one calendar since its token; a token that's lapsed lists it again. */
async function syncCalendar(
  accountId: string,
  calendarId: string,
  epoch: number,
): Promise<boolean> {
  const today = defaultWindow();
  if (await cover(accountId, calendarId, today.fromMs, today.toMs, epoch)) return true;
  const window = store.windowOf(accountId, calendarId);
  if (!window || count(epochs, accountId) !== epoch) throw new Superseded();
  if (!window.token) {
    await listWindow(accountId, calendarId, window, epoch);
    return true;
  }
  const check = guard(accountId, calendarId, epoch);
  let found;
  try {
    found = await calendarOf(accountId).syncEvents(accountId, calendarId, {
      from: new Date(window.fromMs).toISOString(),
      to: new Date(window.toMs).toISOString(),
      token: window.token,
    });
  } catch (error) {
    if (!(error instanceof CalendarSyncExpired)) throw error;
    check();
    await listWindow(accountId, calendarId, window, epoch);
    return true;
  }
  check();
  store.applyChanges(
    accountId,
    calendarId,
    { ...window, token: found.token },
    found.events,
    found.removed,
  );
  return found.events.length > 0 || found.removed.length > 0;
}

async function runSync(accountId: string): Promise<void> {
  const epoch = count(epochs, accountId);
  const check = guard(accountId);
  let list = store.getList(accountId);
  if (!list || list.needsAccess || Date.now() - list.syncedAt > LIST_STALE_MS)
    list = (await refreshList(accountId)) ?? list;
  if (!list) return;
  let any = false;
  for (const calendar of list.calendars) {
    check();
    try {
      any = (await syncCalendar(accountId, calendar.id, epoch)) || any;
      failures.delete(key(accountId, calendar.id));
    } catch (error) {
      if (error instanceof Superseded) continue;
      noteFailure(accountId, calendar.id, error);
      logger.info("calendar-sync", "A calendar didn't sync", {
        accountId,
        error: String(error).slice(0, 200),
      });
    }
  }
  if (any) changed(accountId);
  check();
  await watch(accountId, list.calendars, check).catch((err: unknown) =>
    logger.failure("calendar-sync", `Couldn't watch ${accountId}'s calendars`, err),
  );
}

/** Asks the relay where the provider should send the account's calendar changes, and has it. */
async function watch(
  accountId: string,
  calendars: CalendarInfo[],
  check: () => void,
): Promise<void> {
  const email = accountId.toLowerCase();
  const calendar = calendarOf(accountId);
  if (!getOtterUser() || !linkedAccountIds().has(email)) {
    pushed.delete(accountId);
    await calendar.stopWatchingEvents(accountId);
    return;
  }
  let target = watchTargets.get(email);
  if (!target) {
    target = await relayRequest<CalendarWatchResponse>("POST", "/v1/calendar/watch", { email });
    check();
    watchTargets.set(email, target);
  }
  check();
  const watching = await calendar.watchEvents(
    accountId,
    calendars.map((c) => c.id),
    { notificationUrl: target.notificationUrl, token: target.token },
  );
  try {
    check();
  } catch (error) {
    await calendar.stopWatchingEvents(accountId);
    throw error;
  }
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
    .catch((err: unknown) => {
      if (!(err instanceof Superseded))
        logger.failure("calendar-sync", `${accountId} didn't sync`, err);
    })
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

export function forgetCalendarAccount(accountId: string): void {
  epochs.set(accountId, count(epochs, accountId) + 1);
  clearTimeout(soon.get(accountId));
  soon.delete(accountId);
  pushed.delete(accountId);
  lastSyncAt.delete(accountId);
  void findProvider(accountId)
    ?.calendar?.stopWatchingEvents(accountId)
    .catch(() => {});
  store.removeAccount(accountId);
}

/**
 * The user's change to a calendar: syncs in the meantime are dropped, and the calendar synced
 * again once it's done.
 */
async function editingCalendar<T>(
  accountId: string,
  calendarId: string,
  run: (check: () => void) => Promise<T>,
): Promise<T> {
  const k = key(accountId, calendarId);
  const check = guard(accountId);
  editing.set(k, count(editing, k) + 1);
  edits.set(k, count(edits, k) + 1);
  try {
    return await run(check);
  } finally {
    editing.set(k, count(editing, k) - 1);
    edits.set(k, count(edits, k) + 1);
    if (count(editing, k) === 0) editing.delete(k);
    changed(accountId);
    syncAccountSoon(accountId);
  }
}

/** Whether the store kept an answer: no, once its account is gone. */
const kept = (check: () => void) => {
  try {
    check();
    return true;
  } catch {
    return false;
  }
};

/**
 * A change of the user's to one event: shown at once (`shown`, null when it goes), then the
 * provider's answer (`landed` for what else it changed); put back as it was when refused.
 */
export function changeEvent<T extends CalendarEvent | void>(
  accountId: string,
  calendarId: string,
  eventId: string,
  shown: (before: CalendarEvent) => CalendarEvent | null,
  run: () => Promise<T>,
  landed?: (before: CalendarEvent | null) => void,
): Promise<T> {
  return editingCalendar(accountId, calendarId, async (check) => {
    const before = store.getEvent(accountId, calendarId, eventId);
    if (before) {
      const next = shown(before);
      if (next) store.putEvent(accountId, calendarId, next);
      else store.deleteEvent(accountId, calendarId, eventId);
      changed(accountId);
    }
    let done: T;
    try {
      done = await run();
    } catch (err) {
      if (before && kept(check)) store.putEvent(accountId, calendarId, before);
      throw err;
    }
    if (kept(check)) {
      if (done) store.putEvent(accountId, calendarId, done);
      landed?.(before);
    }
    return done;
  });
}

/**
 * A change to an event named only by its id (the agents'): Google's go to the primary calendar,
 * Outlook's to whichever holds it, as the store says; one it doesn't keep lands with the sync
 * after.
 */
export async function changeEventById<T extends CalendarEvent | void>(
  accountId: string,
  eventId: string,
  shown: (before: CalendarEvent) => CalendarEvent | null,
  run: () => Promise<T>,
): Promise<T> {
  const calendarId =
    findProvider(accountId)?.kind === "gmail"
      ? "primary"
      : store.calendarHolding(accountId, eventId);
  if (calendarId) return changeEvent(accountId, calendarId, eventId, shown, run);
  try {
    return await run();
  } finally {
    syncAccountSoon(accountId);
  }
}

/** A new event; a repeating one comes as its days, with the sync that follows. */
export async function createEvent(
  accountId: string,
  calendarId: string,
  run: () => Promise<CalendarEvent>,
): Promise<CalendarEvent> {
  const made = await editingCalendar(accountId, calendarId, async (check) => {
    const made = await run();
    if (made.seriesId !== made.id && kept(check)) store.putEvent(accountId, calendarId, made);
    return made;
  });
  if (made.seriesId === made.id) syncAccountSoon(accountId, 0);
  return made;
}

/** An answer to an invitation, on every day of its series. */
export function answeredSeries(
  accountId: string,
  calendarId: string,
  seriesId: string,
  response: CalendarEvent["response"],
): void {
  for (const event of store.seriesEvents(accountId, calendarId, seriesId))
    store.putEvent(accountId, calendarId, { ...event, response });
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
