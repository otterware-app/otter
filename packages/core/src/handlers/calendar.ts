/**
 * The Calendar space: each mailbox's calendar (Google Calendar, Outlook's),
 * read for a range and changed in place through its provider.
 */

import { handle } from "../ipc.js";
import { capabilitiesOf, providerFor } from "../providers/index.js";
import {
  NoCalendarAccess,
  type BusyBlock,
  type CalendarEvent,
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

export type CalendarRange =
  | { accountId: string; events: CalendarEvent[] }
  | { accountId: string; error: "noAccess" | "failed"; message: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const RESPONSES = new Set(["accepted", "declined", "tentative"]);

function calendarOf(accountId: string): Calendar {
  const calendar = capabilitiesOf(accountId)?.calendar ? providerFor(accountId).calendar : null;
  if (!calendar) throw new Error(`${accountId} has no calendar.`);
  return calendar;
}

async function listRange(accountId: string, from: string, to: string): Promise<CalendarRange> {
  try {
    const events = await calendarOf(accountId).listEvents(accountId, { from, to, limit: 500 });
    return { accountId, events: events.filter((e) => e.status !== "cancelled") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { accountId, error: error instanceof NoCalendarAccess ? "noAccess" : "failed", message };
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

  handle("calendar:listEvents", async (params: unknown) => {
    const p = params as Params;
    const from = str(p?.from);
    const to = str(p?.to);
    const ids = ((p?.accountIds ?? []) as unknown[]).filter(
      (id): id is string => typeof id === "string",
    );
    if (!from || !to) throw new Error("from and to are required.");
    return Promise.all(ids.map((id) => listRange(id, from, to)));
  });

  handle("calendar:createEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).createEvent(accountId, eventInput(p?.input), p?.notify === true),
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
      ),
    );
  });

  handle("calendar:deleteEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    if (!eventId) throw new Error("eventId is required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      calendarOf(accountId).deleteEvent(accountId, eventId, p?.notify === true),
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
      calendarOf(accountId).respondToEvent(accountId, eventId, response as RsvpResponse),
    );
  });
}
