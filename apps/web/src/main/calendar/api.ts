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

/** An event on one mailbox's calendar, with its times read once. */
export type CalEvent = CalendarEvent & {
  accountId: string;
  startMs: number;
  endMs: number;
  /** A teammate's busy time (⌘P): theirs, so it's only looked at. */
  teammate?: string;
};

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
          ...withTimes(`team:${email}`, {
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
  | { accountId: string; events: CalendarEvent[] }
  | { accountId: string; error: "noAccess" | "failed"; message: string };

/** All-day dates are local days; their end is the day after. */
function instant(value: string, allDay: boolean): number {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(value);
}

export function withTimes(accountId: string, event: CalendarEvent): CalEvent {
  const startMs = instant(event.start, event.allDay);
  const endMs = Math.max(instant(event.end, event.allDay), startMs + (event.allDay ? DAY : 0));
  return { ...event, accountId, startMs, endMs };
}

const KEY = ["calendar", "events"] as const;

type Cached = { events: CalEvent[]; failed: { accountId: string; error: string }[] };

async function fetchRange(accountIds: string[], from: number, to: number): Promise<Cached> {
  const ranges = await ipc<Range[]>("calendar:listEvents", {
    accountIds,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
  });
  return {
    events: ranges.flatMap((r) =>
      "error" in r ? [] : r.events.map((e) => withTimes(r.accountId, e)),
    ),
    failed: ranges.flatMap((r) =>
      "error" in r ? [{ accountId: r.accountId, error: r.error }] : [],
    ),
  };
}

const rangeKey = (accountIds: string[], from: number, to: number) => [...KEY, from, to, accountIds];

/** Each mailbox's events in [from, to); the neighbouring ranges load too, so stepping is instant. */
export function useCalendarEvents(accountIds: string[], from: number, to: number) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: rangeKey(accountIds, from, to),
    queryFn: () => fetchRange(accountIds, from, to),
    enabled: accountIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
  const ids = accountIds.join(",");
  useEffect(() => {
    if (!ids) return;
    const list = ids.split(",");
    for (const shift of [from - to, to - from])
      void qc.prefetchQuery({
        queryKey: rangeKey(list, from + shift, to + shift),
        queryFn: () => fetchRange(list, from + shift, to + shift),
        staleTime: 30_000,
      });
  }, [qc, ids, from, to]);
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
  const replace = (accountId: string, id: string, next: CalEvent | null) =>
    patchCache((events) =>
      next
        ? events.map((e) => (e.accountId === accountId && e.id === id ? next : e))
        : events.filter((e) => !(e.accountId === accountId && e.id === id)),
    );

  return {
    async create(accountId: string, input: EventInput, notify: boolean): Promise<CalEvent | null> {
      try {
        const made = await task<CalendarEvent>("calendar:createEvent", {
          accountId,
          input,
          notify,
        });
        const event = withTimes(accountId, made);
        patchCache((events) => [...events, event]);
        settle();
        return event;
      } catch (err) {
        fail("Couldn't create the event")(err);
        return null;
      }
    },
    update(event: CalEvent, patch: EventInput, notify: boolean): void {
      const optimistic = withTimes(event.accountId, { ...event, ...patch } as CalendarEvent);
      replace(event.accountId, event.id, optimistic);
      task<CalendarEvent>("calendar:updateEvent", {
        accountId: event.accountId,
        eventId: event.id,
        patch,
        notify,
      }).then(
        (saved) => replace(event.accountId, event.id, withTimes(event.accountId, saved)),
        fail("Couldn't change the event"),
      );
    },
    remove(event: CalEvent, notify: boolean): void {
      replace(event.accountId, event.id, null);
      task("calendar:deleteEvent", {
        accountId: event.accountId,
        eventId: event.id,
        notify,
      }).then(settle, fail("Couldn't delete the event"));
    },
    respond(event: CalEvent, response: RsvpResponse): void {
      replace(event.accountId, event.id, { ...event, response });
      task<CalendarEvent>("calendar:respondToEvent", {
        accountId: event.accountId,
        eventId: event.id,
        response,
      }).then((saved) => {
        replace(event.accountId, event.id, withTimes(event.accountId, saved));
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
