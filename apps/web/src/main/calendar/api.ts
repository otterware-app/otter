import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, task } from "~/lib/ipc";
import { toast } from "../mail/toast";
import { DAY, addDays } from "./dates";

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

export type EventInput = {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
};

/** One of a mailbox's calendars. */
export type CalendarInfo = {
  id: string;
  name: string;
  color: string | null;
  primary: boolean;
  writable: boolean;
  hiddenByDefault: boolean;
};

export type AccountCalendars = {
  accountId: string;
  calendars: CalendarInfo[];
  /** Only the primary calendar: the sign-in may not list the others yet. */
  needsAccess?: boolean;
  error?: "noAccess" | "failed";
};

/** Which calendar: a mailbox's, by its id there. */
export type CalendarRef = { accountId: string; calendarId: string; writable: boolean };

export const calendarKey = (ref: { accountId: string; calendarId: string }) =>
  `${ref.accountId}|${ref.calendarId}`;

/** An event on one of a mailbox's calendars, with its times read once. */
export type CalEvent = CalendarEvent & {
  accountId: string;
  calendarId: string;
  startMs: number;
  endMs: number;
  /** On a calendar it can't change (a followed one, a teammate's): only looked at. */
  readOnly?: boolean;
  /** A teammate's busy time (⌘P). */
  teammate?: string;
};

/** Each mailbox's calendars; they change rarely. */
export function useCalendarLists(accountIds: string[]) {
  return useQuery({
    queryKey: ["calendar", "lists", accountIds],
    queryFn: () => ipc<AccountCalendars[]>("calendar:listCalendars", { accountIds }),
    enabled: accountIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export type BusyBlock = { start: string; end: string; title: string | null };

type TeammateSchedule = {
  email: string;
  accountId: string;
  blocks: BusyBlock[] | null;
  error?: "noAccess" | "failed";
};

/** The teammates' busy times over the range, as events of their own (accountId `team:` + address). */
export function useTeamEvents(accountIds: string[], emails: string[], from: number, to: number) {
  return useQuery({
    queryKey: ["calendar", "team", from, to, accountIds, emails],
    queryFn: async () => {
      const found = await ipc<TeammateSchedule[]>("calendar:schedule", {
        accountIds,
        emails,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      const events: CalEvent[] = found.flatMap(({ email, blocks }) =>
        (blocks ?? []).map((b, i) => ({
          ...withTimes(`team:${email}`, "busy", {
            id: `${email}:${i}:${b.start}`,
            title: b.title ?? "Busy",
            start: b.start,
            end: b.end,
            allDay: false,
            location: null,
            description: null,
            status: "confirmed",
            organizer: null,
            attendees: [],
            response: null,
            meetingLink: null,
            htmlLink: null,
            recurring: false,
          }),
          teammate: email,
          readOnly: true,
        })),
      );
      return { events, schedules: found };
    },
    enabled: accountIds.length > 0 && emails.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

type Range =
  | { accountId: string; calendarId: string; events: CalendarEvent[] }
  | { accountId: string; calendarId: string; error: "noAccess" | "failed"; message: string };

/** All-day dates are local days; their end is the day after. */
function instant(value: string, allDay: boolean): number {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(value);
}

export function withTimes(accountId: string, calendarId: string, event: CalendarEvent): CalEvent {
  const startMs = instant(event.start, event.allDay);
  const endMs = Math.max(instant(event.end, event.allDay), startMs + (event.allDay ? DAY : 0));
  return { ...event, accountId, calendarId, startMs, endMs };
}

const sameEvent = (e: CalEvent, of: CalEvent) =>
  e.accountId === of.accountId && e.calendarId === of.calendarId && e.id === of.id;

const KEY = ["calendar", "events"] as const;

type Cached = {
  events: CalEvent[];
  failed: { accountId: string; calendarId: string; error: string }[];
};

async function fetchRange(refs: CalendarRef[], from: number, to: number): Promise<Cached> {
  const ranges = await ipc<Range[]>("calendar:listEvents", {
    calendars: refs.map(({ accountId, calendarId }) => ({ accountId, calendarId })),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });
  const writable = new Set(refs.filter((r) => r.writable).map(calendarKey));
  return {
    events: ranges.flatMap((r) =>
      "error" in r
        ? []
        : r.events.map((e) => ({
            ...withTimes(r.accountId, r.calendarId, e),
            ...(writable.has(calendarKey(r)) ? {} : { readOnly: true }),
          })),
    ),
    failed: ranges.flatMap((r) =>
      "error" in r ? [{ accountId: r.accountId, calendarId: r.calendarId, error: r.error }] : [],
    ),
  };
}

const rangeKey = (refs: CalendarRef[], from: number, to: number) => [
  ...KEY,
  from,
  to,
  refs.map(calendarKey),
];

/** The calendars' events in [from, to); the neighbouring ranges load too, so stepping is instant. */
export function useCalendarEvents(refs: CalendarRef[], from: number, to: number) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: rangeKey(refs, from, to),
    queryFn: () => fetchRange(refs, from, to),
    enabled: refs.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  const latest = JSON.stringify(refs);
  useEffect(() => {
    const list = JSON.parse(latest) as CalendarRef[];
    if (!list.length) return;
    for (const shift of [from - to, to - from])
      void qc.prefetchQuery({
        queryKey: rangeKey(list, from + shift, to + shift),
        queryFn: () => fetchRange(list, from + shift, to + shift),
        staleTime: 30_000,
      });
  }, [qc, latest, from, to]);
  return query;
}

/** Changes land in every cached range at once, then the calendar catches up. */
export function useCalendarActions() {
  const qc = useQueryClient();
  const patchCache = (change: (events: CalEvent[]) => CalEvent[]) =>
    qc.setQueriesData<Cached>({ queryKey: KEY }, (data) =>
      data ? { ...data, events: change(data.events) } : data,
    );
  const settle = () => void qc.invalidateQueries({ queryKey: KEY });
  const fail = (what: string) => (err: unknown) => {
    toast.error(what, { description: err instanceof Error ? err.message : String(err) });
    settle();
  };
  const replace = (of: CalEvent, next: CalEvent | null) =>
    patchCache((events) =>
      next
        ? events.map((e) => (sameEvent(e, of) ? next : e))
        : events.filter((e) => !sameEvent(e, of)),
    );
  const saved = (of: CalEvent, event: CalendarEvent): CalEvent => ({
    ...withTimes(of.accountId, of.calendarId, event),
    ...(of.readOnly ? { readOnly: true } : {}),
  });
  const where = (event: CalEvent) => ({
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.id,
  });

  return {
    async create(
      ref: { accountId: string; calendarId: string },
      input: EventInput,
      notify: boolean,
    ): Promise<CalEvent | null> {
      try {
        const made = await task<CalendarEvent>("calendar:createEvent", {
          accountId: ref.accountId,
          calendarId: ref.calendarId,
          input,
          notify,
        });
        const event = withTimes(ref.accountId, ref.calendarId, made);
        patchCache((events) => [...events, event]);
        settle();
        return event;
      } catch (err) {
        fail("Couldn't create the event")(err);
        return null;
      }
    },
    update(event: CalEvent, patch: EventInput, notify: boolean): void {
      replace(event, saved(event, { ...event, ...patch } as CalendarEvent));
      task<CalendarEvent>("calendar:updateEvent", { ...where(event), patch, notify }).then(
        (done) => replace(event, saved(event, done)),
        fail("Couldn't change the event"),
      );
    },
    remove(event: CalEvent, notify: boolean): void {
      replace(event, null);
      task("calendar:deleteEvent", { ...where(event), notify }).then(
        settle,
        fail("Couldn't delete the event"),
      );
    },
    respond(event: CalEvent, response: RsvpResponse): void {
      replace(event, { ...event, response });
      task<CalendarEvent>("calendar:respondToEvent", { ...where(event), response }).then((done) => {
        replace(event, saved(event, done));
        // A declined invitation can leave the calendar (Outlook removes it).
        settle();
      }, fail("Couldn't answer the invitation"));
    },
  };
}

/** Times as the provider takes them: an instant, or a local day for all-day events. */
export function eventTimes(startMs: number, endMs: number, allDay: boolean): EventInput {
  if (!allDay)
    return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
  const key = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return {
    start: key(startMs),
    end: key(Math.max(endMs, addDays(new Date(startMs), 1).getTime())),
    allDay,
  };
}

/** Attendees other than you: changing the event tells them. */
export const hasGuests = (event: CalEvent) =>
  event.attendees.some((a) => a.email.toLowerCase() !== event.accountId.toLowerCase());
