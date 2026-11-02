/**
 * The Calendar space: each mailbox's calendars (Google Calendar, Outlook's),
 * listed, read for a range and changed in place through its provider.
 */

import { handle } from "../ipc.js";
import { capabilitiesOf, providerFor } from "../providers/index.js";
import {
  NoCalendarAccess,
  type BusyBlock,
  type CalendarEvent,
  type CalendarInfo,
  type EventInput,
  type MailProvider,
  type RsvpResponse,
} from "../providers/provider.js";
import { runAsTask } from "./ipc-budget.js";

type Calendar = NonNullable<MailProvider["calendar"]>;
type Params = Record<string, unknown> | undefined;

export type TeammateSchedule = {
  email: string;
  /** Through which mailbox's calendar it was asked. */
  accountId: string;
  blocks: BusyBlock[] | null;
  error?: "noAccess" | "failed";
};

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

const str = (v: unknown) => (typeof v === "string" ? v : "");
const RESPONSES = new Set(["accepted", "declined", "tentative"]);

function calendarOf(accountId: string): Calendar {
  const calendar = capabilitiesOf(accountId)?.calendar ? providerFor(accountId).calendar : null;
  if (!calendar) throw new Error(`${accountId} has no calendar.`);
  return calendar;
}

/** An account's calendars; a sign-in that can't list them still has its primary one. */
async function accountCalendars(accountId: string): Promise<AccountCalendars> {
  try {
    return { accountId, calendars: await calendarOf(accountId).listCalendars(accountId) };
  } catch (error) {
    if (!(error instanceof NoCalendarAccess)) return { accountId, calendars: [], error: "failed" };
    const primary: CalendarInfo = {
      id: "primary",
      name: accountId,
      color: null,
      primary: true,
      writable: true,
      hiddenByDefault: false,
    };
    return { accountId, calendars: [primary], needsAccess: true };
  }
}

async function listRange(
  accountId: string,
  calendarId: string,
  from: string,
  to: string,
): Promise<CalendarRange> {
  try {
    const events = await calendarOf(accountId).listEvents(accountId, {
      from,
      to,
      limit: 500,
      calendarId: calendarId || undefined,
    });
    return { accountId, calendarId, events: events.filter((e) => e.status !== "cancelled") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof NoCalendarAccess ? "noAccess" : "failed";
    return { accountId, calendarId, error: kind, message };
  }
}

function eventInput(value: unknown): EventInput {
  const input = (value ?? {}) as EventInput;
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as EventInput;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** Teammates' busy times, each asked through a mailbox on their domain, else the first. */
async function teammateSchedules(
  accountIds: string[],
  emails: string[],
  from: string,
  to: string,
): Promise<TeammateSchedule[]> {
  const usable = accountIds.filter((id) => capabilitiesOf(id)?.calendar);
  if (!usable.length) return [];
  const groups = new Map<string, string[]>();
  for (const email of emails) {
    const via = usable.find((id) => domainOf(id) === domainOf(email)) ?? usable[0]!;
    groups.set(via, [...(groups.get(via) ?? []), email]);
  }
  const results = await Promise.all(
    [...groups].map(async ([accountId, group]): Promise<TeammateSchedule[]> => {
      try {
        const found = await calendarOf(accountId).schedule(accountId, group, { from, to });
        return group.map((email) => ({ email, accountId, blocks: found[email] ?? null }));
      } catch (error) {
        const kind = error instanceof NoCalendarAccess ? "noAccess" : "failed";
        return group.map((email) => ({ email, accountId, blocks: null, error: kind }));
      }
    }),
  );
  return results.flat();
}

const strings = (value: unknown) =>
  ((value ?? []) as unknown[]).filter((v): v is string => typeof v === "string");

export function registerCalendarHandlers(): void {
  handle("calendar:schedule", async (params: unknown) => {
    const p = params as Params;
    const from = str(p?.from);
    const to = str(p?.to);
    if (!from || !to) throw new Error("from and to are required.");
    return teammateSchedules(strings(p?.accountIds), strings(p?.emails), from, to);
  });

  handle("calendar:listCalendars", async (params: unknown) =>
    Promise.all(strings((params as Params)?.accountIds).map(accountCalendars)),
  );

  handle("calendar:listEvents", async (params: unknown) => {
    const p = params as Params;
    const from = str(p?.from);
    const to = str(p?.to);
    if (!from || !to) throw new Error("from and to are required.");
    const calendars = ((p?.calendars ?? []) as { accountId?: unknown; calendarId?: unknown }[])
      .map((c) => ({ accountId: str(c?.accountId), calendarId: str(c?.calendarId) }))
      .filter((c) => c.accountId);
    return Promise.all(calendars.map((c) => listRange(c.accountId, c.calendarId, from, to)));
  });

  handle("calendar:createEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).createEvent(
        accountId,
        eventInput(p?.input),
        p?.notify === true,
        str(p?.calendarId) || undefined,
      ),
    );
  });

  handle("calendar:updateEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    if (!eventId) throw new Error("eventId is required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).updateEvent(
        accountId,
        eventId,
        eventInput(p?.patch),
        p?.notify === true,
        str(p?.calendarId) || undefined,
      ),
    );
  });

  handle("calendar:deleteEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    if (!eventId) throw new Error("eventId is required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).deleteEvent(
        accountId,
        eventId,
        p?.notify === true,
        str(p?.calendarId) || undefined,
      ),
    );
  });

  handle("calendar:respondToEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    const response = str(p?.response);
    if (!eventId || !RESPONSES.has(response))
      throw new Error("eventId and a valid response are required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).respondToEvent(
        accountId,
        eventId,
        response as RsvpResponse,
        str(p?.calendarId) || undefined,
      ),
    );
  });
}
