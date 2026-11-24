import { handle } from "../ipc.ts";
import { capabilitiesOf, providerFor } from "../providers/index.ts";
import {
  NoCalendarAccess,
  type BusyBlock,
  type EventInput,
  type MailProvider,
  type RsvpResponse,
} from "../providers/provider.ts";
import {
  accountCalendars,
  answeredSeries,
  changeEvent,
  createEvent,
  eventsInRange,
  patched,
  syncDueCalendars,
} from "../services/calendar-sync.ts";
import { runAsTask } from "./ipc-budget.ts";

type Calendar = NonNullable<MailProvider["calendar"]>;
type Params = Record<string, unknown> | undefined;

export type TeammateSchedule = {
  email: string;
  accountId: string;
  blocks: BusyBlock[] | null;
  error?: "noAccess" | "failed";
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const RESPONSES = new Set(["accepted", "declined", "tentative"]);

function calendarOf(accountId: string): Calendar {
  const calendar = capabilitiesOf(accountId)?.calendar ? providerFor(accountId).calendar : null;
  if (!calendar) throw new Error(`${accountId} has no calendar.`);
  return calendar;
}

const REPEATS = new Set(["daily", "weekdays", "weekly", "monthly", "yearly"]);

function eventInput(value: unknown): EventInput {
  const input = { ...((value ?? {}) as EventInput) };
  if (input.repeat !== undefined && !REPEATS.has(input.repeat)) delete input.repeat;
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as EventInput;
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

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

/** Every change names its calendar: the store keeps events by it. */
function calendarIdOf(p: Params): string {
  const calendarId = str(p?.calendarId);
  if (!calendarId) throw new Error("calendarId is required.");
  return calendarId;
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
      .filter((c) => c.accountId && c.calendarId);
    return eventsInRange(calendars, from, to);
  });

  handle("calendar:sync", async () => {
    await syncDueCalendars("asked");
  });

  handle("calendar:createEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const calendarId = calendarIdOf(p);
    return runAsTask(str(p?.taskId) || undefined, () =>
      createEvent(accountId, calendarId, () =>
        calendarOf(accountId).createEvent(
          accountId,
          eventInput(p?.input),
          p?.notify === true,
          calendarId,
        ),
      ),
    );
  });

  handle("calendar:updateEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    if (!eventId) throw new Error("eventId is required.");
    const calendarId = calendarIdOf(p);
    const patch = eventInput(p?.patch);
    return runAsTask(str(p?.taskId) || undefined, () =>
      changeEvent(
        accountId,
        calendarId,
        eventId,
        (before) => patched(before, patch),
        () =>
          calendarOf(accountId).updateEvent(
            accountId,
            eventId,
            patch,
            p?.notify === true,
            calendarId,
          ),
      ),
    );
  });

  handle("calendar:deleteEvent", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const eventId = str(p?.eventId);
    if (!eventId) throw new Error("eventId is required.");
    const calendarId = calendarIdOf(p);
    return runAsTask(str(p?.taskId) || undefined, () =>
      changeEvent(
        accountId,
        calendarId,
        eventId,
        () => null,
        () => calendarOf(accountId).deleteEvent(accountId, eventId, p?.notify === true, calendarId),
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
    const calendarId = calendarIdOf(p);
    const allEvents = p?.allEvents === true;
    return runAsTask(str(p?.taskId) || undefined, () =>
      changeEvent(
        accountId,
        calendarId,
        eventId,
        (before) => ({ ...before, response: response as RsvpResponse }),
        () =>
          calendarOf(accountId).respondToEvent(
            accountId,
            eventId,
            response as RsvpResponse,
            calendarId,
            { allEvents, comment: str(p?.comment) || undefined },
          ),
        (before) => {
          // The series' other days once the provider took it; the sync after confirms them.
          if (allEvents && before?.seriesId)
            answeredSeries(accountId, calendarId, before.seriesId, response as RsvpResponse);
        },
      ),
    );
  });
}
