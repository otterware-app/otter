import { platform, type SqlDatabase } from "../platform.js";
import type { CalendarEvent, CalendarInfo } from "../providers/provider.js";

/**
 * The calendars' events, kept as their providers last said (calendar-sync.ts keeps them
 * current), so any range draws from here at once. A calendar's window is the range listed
 * from the provider, with the token for what changed since.
 */

export type StoredList = { calendars: CalendarInfo[]; needsAccess?: boolean; syncedAt: number };

export type Window = { fromMs: number; toMs: number; token: string | null };

const DAY_MS = 86_400_000;

let db: SqlDatabase | null = null;

function getDb(): SqlDatabase {
  if (db) return db;
  const handle = platform().database();
  handle.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      accountId  TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      id         TEXT NOT NULL,
      startMs    INTEGER NOT NULL,
      endMs      INTEGER NOT NULL,
      seriesId   TEXT,
      event      TEXT NOT NULL,
      PRIMARY KEY (accountId, calendarId, id)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start
      ON calendar_events (accountId, calendarId, startMs);

    CREATE TABLE IF NOT EXISTS calendar_windows (
      accountId  TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      fromMs     INTEGER NOT NULL,
      toMs       INTEGER NOT NULL,
      token      TEXT,
      PRIMARY KEY (accountId, calendarId)
    );

    CREATE TABLE IF NOT EXISTS calendar_lists (
      accountId TEXT PRIMARY KEY,
      list      TEXT NOT NULL
    );
  `);
  // A series kept as an event of its own came from Outlook's delta before its occurrences were
  // filled in from it: its calendar is listed again.
  const broken = `SELECT accountId, calendarId FROM calendar_events WHERE id = seriesId`;
  handle.exec(`
    DELETE FROM calendar_windows WHERE (accountId, calendarId) IN (${broken});
    DELETE FROM calendar_events WHERE (accountId, calendarId) IN (${broken});
  `);
  db = handle;
  return handle;
}

function transaction(run: (d: SqlDatabase) => void): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    run(d);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/** All-day dates are local days, their end the day after; as the renderer reads them. */
function instant(value: string, allDay: boolean): number {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y!, m! - 1, d!).getTime();
  }
  return Date.parse(value);
}

export function timesOf(event: CalendarEvent): { startMs: number; endMs: number } {
  const startMs = instant(event.start, event.allDay) || 0;
  const endMs = Math.max(
    instant(event.end, event.allDay) || 0,
    startMs + (event.allDay ? DAY_MS : 0),
  );
  return { startMs, endMs };
}

const parse = (row: Record<string, unknown>) => JSON.parse(String(row.event)) as CalendarEvent;

function put(d: SqlDatabase, accountId: string, calendarId: string, event: CalendarEvent): void {
  const { startMs, endMs } = timesOf(event);
  d.prepare(
    `INSERT OR REPLACE INTO calendar_events (accountId, calendarId, id, startMs, endMs, seriesId, event)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(accountId, calendarId, event.id, startMs, endMs, event.seriesId, JSON.stringify(event));
}

export function putEvent(accountId: string, calendarId: string, event: CalendarEvent): void {
  put(getDb(), accountId, calendarId, event);
}

export function deleteEvent(accountId: string, calendarId: string, id: string): void {
  getDb()
    .prepare("DELETE FROM calendar_events WHERE accountId = ? AND calendarId = ? AND id = ?")
    .run(accountId, calendarId, id);
}

export function getEvent(accountId: string, calendarId: string, id: string): CalendarEvent | null {
  const row = getDb()
    .prepare("SELECT event FROM calendar_events WHERE accountId = ? AND calendarId = ? AND id = ?")
    .get(accountId, calendarId, id);
  return row ? parse(row) : null;
}

/** The calendar the account keeps an event in, when it does. */
export function calendarHolding(accountId: string, id: string): string | null {
  const row = getDb()
    .prepare("SELECT calendarId FROM calendar_events WHERE accountId = ? AND id = ? LIMIT 1")
    .get(accountId, id);
  return row ? String(row.calendarId) : null;
}

export function seriesEvents(
  accountId: string,
  calendarId: string,
  seriesId: string,
): CalendarEvent[] {
  return getDb()
    .prepare(
      "SELECT event FROM calendar_events WHERE accountId = ? AND calendarId = ? AND seriesId = ?",
    )
    .all(accountId, calendarId, seriesId)
    .map(parse);
}

/** The events in [fromMs, toMs); all-day ones as their dates fall in this time zone. */
export function eventsIn(
  accountId: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
): CalendarEvent[] {
  return getDb()
    .prepare(
      `SELECT event FROM calendar_events
       WHERE accountId = ? AND calendarId = ? AND startMs < ? AND endMs > ?
       ORDER BY startMs`,
    )
    .all(accountId, calendarId, toMs + DAY_MS, fromMs - DAY_MS)
    .map(parse)
    .filter((event) => {
      const { startMs, endMs } = timesOf(event);
      return startMs < toMs && endMs > fromMs;
    });
}

/** Changes since the window's token, and the token for the next ones. */
export function applyChanges(
  accountId: string,
  calendarId: string,
  window: Window,
  events: CalendarEvent[],
  removed: string[],
): void {
  transaction((d) => {
    for (const event of events) put(d, accountId, calendarId, event);
    const remove = d.prepare(
      "DELETE FROM calendar_events WHERE accountId = ? AND calendarId = ? AND id = ?",
    );
    for (const id of removed) remove.run(accountId, calendarId, id);
    setWindow(d, accountId, calendarId, window);
  });
}

/** The window listed whole: what it held and the listing didn't name is gone. */
export function replaceWindow(
  accountId: string,
  calendarId: string,
  window: Window,
  events: CalendarEvent[],
): void {
  transaction((d) => {
    const kept = new Set(events.map((e) => e.id));
    const stale = d
      .prepare(
        `SELECT id FROM calendar_events
         WHERE accountId = ? AND calendarId = ? AND startMs < ? AND endMs > ?`,
      )
      .all(accountId, calendarId, window.toMs, window.fromMs)
      .map((row) => String(row.id))
      .filter((id) => !kept.has(id));
    const remove = d.prepare(
      "DELETE FROM calendar_events WHERE accountId = ? AND calendarId = ? AND id = ?",
    );
    for (const id of stale) remove.run(accountId, calendarId, id);
    for (const event of events) put(d, accountId, calendarId, event);
    setWindow(d, accountId, calendarId, window);
  });
}

function setWindow(d: SqlDatabase, accountId: string, calendarId: string, window: Window) {
  d.prepare(
    `INSERT OR REPLACE INTO calendar_windows (accountId, calendarId, fromMs, toMs, token)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(accountId, calendarId, window.fromMs, window.toMs, window.token);
}

export function windowOf(accountId: string, calendarId: string): Window | null {
  const row = getDb()
    .prepare(
      "SELECT fromMs, toMs, token FROM calendar_windows WHERE accountId = ? AND calendarId = ?",
    )
    .get(accountId, calendarId);
  return row
    ? {
        fromMs: Number(row.fromMs),
        toMs: Number(row.toMs),
        token: row.token === null ? null : String(row.token),
      }
    : null;
}

export function getList(accountId: string): StoredList | null {
  const row = getDb().prepare("SELECT list FROM calendar_lists WHERE accountId = ?").get(accountId);
  return row ? (JSON.parse(String(row.list)) as StoredList) : null;
}

/**
 * The account's calendars; the events of those it no longer lists go, unless the list is only
 * the primary one because the sign-in may not read the rest yet.
 */
export function saveList(accountId: string, list: StoredList): void {
  transaction((d) => {
    d.prepare("INSERT OR REPLACE INTO calendar_lists (accountId, list) VALUES (?, ?)").run(
      accountId,
      JSON.stringify(list),
    );
    if (list.needsAccess) return;
    const ids = list.calendars.map((c) => c.id);
    const marks = ids.map(() => "?").join(", ") || "''";
    for (const table of ["calendar_events", "calendar_windows"])
      d.prepare(`DELETE FROM ${table} WHERE accountId = ? AND calendarId NOT IN (${marks})`).run(
        accountId,
        ...ids,
      );
  });
}

export function removeAccount(accountId: string): void {
  transaction((d) => {
    for (const table of ["calendar_events", "calendar_windows", "calendar_lists"])
      d.prepare(`DELETE FROM ${table} WHERE accountId = ?`).run(accountId);
  });
}
