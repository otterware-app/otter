import { platform, type SqlDatabase } from "../platform.js";
import type { CalendarEvent, CalendarInfo } from "../providers/provider.js";

/**
 * The calendars' events, kept as their providers last said (calendar-sync.ts keeps them
 * current), so any range draws from here at once. A calendar's segments are the ranges listed
 * from the provider, each with the token for what changed since.
 */

export type StoredList = { calendars: CalendarInfo[]; needsAccess?: boolean; syncedAt: number };

export type Segment = { fromMs: number; toMs: number; token: string | null };

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

    CREATE TABLE IF NOT EXISTS calendar_segments (
      accountId  TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      fromMs     INTEGER NOT NULL,
      toMs       INTEGER NOT NULL,
      token      TEXT,
      PRIMARY KEY (accountId, calendarId, fromMs)
    );

    CREATE TABLE IF NOT EXISTS calendar_lists (
      accountId TEXT PRIMARY KEY,
      list      TEXT NOT NULL
    );
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
  return row ? (JSON.parse(String(row.event)) as CalendarEvent) : null;
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
    .map((row) => JSON.parse(String(row.event)) as CalendarEvent);
}

/** The events in [fromMs, toMs), a day either side for all-day ones read in another zone. */
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
    .map((row) => JSON.parse(String(row.event)) as CalendarEvent);
}

/**
 * Changes since a token: upserts and removals, except the events `skip` holds (a change of the
 * user's still on its way: its answer lands them). A removed series takes its instances along.
 */
export function applyChanges(
  accountId: string,
  calendarId: string,
  events: CalendarEvent[],
  removed: string[],
  skip: (id: string) => boolean,
): void {
  transaction((d) => {
    for (const event of events) if (!skip(event.id)) put(d, accountId, calendarId, event);
    const remove = d.prepare(
      "DELETE FROM calendar_events WHERE accountId = ? AND calendarId = ? AND (id = ? OR seriesId = ?)",
    );
    for (const id of removed) if (!skip(id)) remove.run(accountId, calendarId, id, id);
  });
}

/** A range listed whole: what it held and the listing didn't name is gone. */
export function replaceRange(
  accountId: string,
  calendarId: string,
  segment: Segment,
  events: CalendarEvent[],
  skip: (id: string) => boolean,
): void {
  transaction((d) => {
    const kept = new Set(events.map((e) => e.id));
    const stale = d
      .prepare(
        `SELECT id FROM calendar_events
         WHERE accountId = ? AND calendarId = ? AND startMs < ? AND endMs > ?`,
      )
      .all(accountId, calendarId, segment.toMs, segment.fromMs)
      .map((row) => String(row.id))
      .filter((id) => !kept.has(id) && !skip(id));
    const remove = d.prepare(
      "DELETE FROM calendar_events WHERE accountId = ? AND calendarId = ? AND id = ?",
    );
    for (const id of stale) remove.run(accountId, calendarId, id);
    for (const event of events) if (!skip(event.id)) put(d, accountId, calendarId, event);
    setSegment(d, accountId, calendarId, segment);
  });
}

function setSegment(d: SqlDatabase, accountId: string, calendarId: string, segment: Segment) {
  d.prepare(
    `INSERT OR REPLACE INTO calendar_segments (accountId, calendarId, fromMs, toMs, token)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(accountId, calendarId, segment.fromMs, segment.toMs, segment.token);
}

export function saveToken(accountId: string, calendarId: string, segment: Segment): void {
  setSegment(getDb(), accountId, calendarId, segment);
}

export function segmentsOf(accountId: string, calendarId: string): Segment[] {
  return getDb()
    .prepare(
      "SELECT fromMs, toMs, token FROM calendar_segments WHERE accountId = ? AND calendarId = ? ORDER BY fromMs",
    )
    .all(accountId, calendarId)
    .map((row) => ({
      fromMs: Number(row.fromMs),
      toMs: Number(row.toMs),
      token: row.token === null ? null : String(row.token),
    }));
}

export function getList(accountId: string): StoredList | null {
  const row = getDb().prepare("SELECT list FROM calendar_lists WHERE accountId = ?").get(accountId);
  return row ? (JSON.parse(String(row.list)) as StoredList) : null;
}

/** The account's calendars; the events and segments of those it no longer lists go. */
export function saveList(accountId: string, list: StoredList): void {
  transaction((d) => {
    d.prepare("INSERT OR REPLACE INTO calendar_lists (accountId, list) VALUES (?, ?)").run(
      accountId,
      JSON.stringify(list),
    );
    const ids = list.calendars.map((c) => c.id);
    const marks = ids.map(() => "?").join(", ") || "''";
    for (const table of ["calendar_events", "calendar_segments"])
      d.prepare(`DELETE FROM ${table} WHERE accountId = ? AND calendarId NOT IN (${marks})`).run(
        accountId,
        ...ids,
      );
  });
}

export function removeAccount(accountId: string): void {
  transaction((d) => {
    for (const table of ["calendar_events", "calendar_segments", "calendar_lists"])
      d.prepare(`DELETE FROM ${table} WHERE accountId = ?`).run(accountId);
  });
}
