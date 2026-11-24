import type { CSSProperties, ReactNode } from "react";
import { ChevronsLeftIcon } from "lucide-react";
import { ScrollArea } from "@otter/ui/components/scroll-area";
import { useAccounts } from "@otter/client/mail/hooks";
import { PanelControlSlot } from "../mail/top-bar";
import { calendarKey, useCalendarLists, useUpcomingEvents, type CalEvent } from "./api";
import { isShown, useCalendar } from "./calendar-store";
import { calendarAccounts, legible, listedCalendars, type ListedCalendar } from "./calendar-view";
import { addDays, dayKey, durationLabel, sameDay, startOfDay } from "./dates";
import { isPending, rangeLabel } from "./event-style";
import { useCalendarPreferences } from "./preferences";
import { useNow } from "./time-grid";
import { Button, IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

function dayTitle(day: Date, now: Date): string {
  if (sameDay(day, now)) return "Today";
  if (sameDay(day, addDays(now, 1))) return "Tomorrow";
  return day.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const PANEL_DAYS = 30;

/** Every shown calendar's coming month, beside the app (the panel by the browser's). */
export function CalendarPanel({ onOpen }: { onOpen: (event: CalEvent) => void }) {
  const accounts = calendarAccounts(useAccounts().data ?? []);
  const listsQuery = useCalendarLists(accounts.map((a) => a.id));
  const lists = listsQuery.data;
  const listsFailed = listsQuery.isError || !!lists?.some((l) => l.error === "failed");
  const { colors, showDeclined } = useCalendarPreferences();
  const shown = useCalendar((s) => s.shown);
  const visible = listedCalendars(accounts, lists, colors).filter((c) =>
    isShown(shown, c.key, c.info.hiddenByDefault),
  );
  const colorOf = new Map(visible.map((c) => [c.key, legible(c.color)]));
  const now = useNow();
  const from = startOfDay(now).getTime();
  const query = useUpcomingEvents(
    visible.map((c) => ({
      accountId: c.account.id,
      calendarId: c.info.id,
      writable: c.info.writable,
    })),
    from,
    PANEL_DAYS,
  );
  const events = (query.data?.events ?? []).filter(
    (e) => colorOf.has(calendarKey(e)) && (showDeclined || e.response !== "declined"),
  );
  // A calendar shared without its details (free/busy only) can't be read: not a failure to retry.
  const eventsFailed = query.isError || !!query.data?.failed.some((f) => f.error !== "noAccess");

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pl-4 pr-2">
        <span className="min-w-0 flex-1 truncate text-body font-medium font-reading">Upcoming</span>
        {/* The pinned panel toggles (home view) sit here. */}
        <PanelControlSlot />
      </div>
      <AgendaDays
        events={events}
        from={from}
        now={now}
        colorOf={(e) => colorOf.get(calendarKey(e)) ?? "#8a8a8a"}
        onOpen={onOpen}
        loading={listsQuery.isPending || (query.isPending && visible.length > 0)}
        failed={listsFailed || eventsFailed}
        onRetry={() => {
          if (listsFailed) void listsQuery.refetch();
          if (eventsFailed) void query.refetch();
        }}
        empty={visible.length ? "Nothing in the next 30 days." : "No calendars shown."}
      />
    </div>
  );
}

export function AgendaDrawer({
  calendar,
  color,
  titleLeading,
}: {
  calendar: ListedCalendar;
  color: string;
  titleLeading?: ReactNode;
}) {
  const setAgenda = useCalendar((s) => s.setAgenda);
  const show = useCalendar((s) => s.show);
  const now = useNow();
  const from = startOfDay(now).getTime();
  const query = useUpcomingEvents(
    [
      {
        accountId: calendar.account.id,
        calendarId: calendar.info.id,
        writable: calendar.info.writable,
      },
    ],
    from,
    365,
  );
  const events = (query.data?.events ?? []).filter(
    (e) => e.accountId === calendar.account.id && e.calendarId === calendar.info.id,
  );

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border/60 animate-calendar-fade motion-reduce:animate-none">
      <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pl-4 pr-2">
        {titleLeading}
        <span aria-hidden className="size-3.5 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate text-body font-medium">{calendar.info.name}</span>
        <IconButton label="Close" className="no-drag" onClick={() => setAgenda(null)}>
          <ChevronsLeftIcon />
        </IconButton>
      </div>
      <AgendaDays
        events={events}
        from={from}
        now={now}
        colorOf={() => color}
        onOpen={show}
        loading={query.isPending}
        failed={query.isError || !!query.data?.failed.length}
        onRetry={() => void query.refetch()}
        empty="Nothing coming up in the next year."
      />
    </aside>
  );
}

function AgendaDays({
  events: all,
  from,
  now,
  colorOf,
  onOpen,
  loading,
  failed,
  onRetry,
  empty,
}: {
  events: CalEvent[];
  from: number;
  now: Date;
  colorOf: (event: CalEvent) => string;
  onOpen: (event: CalEvent) => void;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  empty: string;
}) {
  const events = all
    .filter((e) => e.endMs > now.getTime())
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const days: { day: Date; events: CalEvent[] }[] = [];
  for (const event of events) {
    const day = startOfDay(new Date(Math.max(event.startMs, from)));
    const last = days[days.length - 1];
    if (last && dayKey(last.day) === dayKey(day)) last.events.push(event);
    else days.push({ day, events: [event] });
  }

  return (
    <ScrollArea className="flex-1" contentClassName="px-2 pb-agent-corner">
      {days.map(({ day, events }) => (
        <section key={dayKey(day)} className="pt-3">
          <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            {dayTitle(day, now)}
          </h3>
          {events.map((event) => (
            <button
              key={`${calendarKey(event)}:${event.id}`}
              type="button"
              onClick={() => onOpen(event)}
              style={{ "--event-color": colorOf(event) } as CSSProperties}
              className="flex w-full cursor-pointer gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <span
                aria-hidden
                className={cn(
                  "w-[3px] shrink-0 rounded-full",
                  isPending(event)
                    ? "border border-dashed border-(--event-color)"
                    : "bg-(--event-color)",
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    "truncate text-body font-medium text-foreground",
                    event.response === "declined" && "text-muted-foreground line-through",
                  )}
                >
                  {event.title}
                </span>
                <span className="truncate text-xs tabular-nums text-muted-foreground">
                  {event.allDay ? (
                    "All-day"
                  ) : (
                    <>
                      {rangeLabel(event.startMs, event.endMs)}
                      <span className="ml-1.5 text-faint-foreground">
                        {durationLabel(event.endMs - event.startMs)}
                      </span>
                    </>
                  )}
                </span>
              </span>
            </button>
          ))}
        </section>
      ))}
      {failed ? (
        <div className="flex flex-col items-center gap-2 px-2 pt-6 text-center text-body text-muted-foreground">
          Couldn&apos;t load some events.
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : !loading && !days.length ? (
        <p className="px-2 pt-6 text-center text-body text-muted-foreground">{empty}</p>
      ) : null}
    </ScrollArea>
  );
}
