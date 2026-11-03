import type { CSSProperties, ReactNode } from "react";
import { ChevronsLeftIcon } from "lucide-react";
import { IconBtn, buttonClass, cn } from "../mail/ui";
import { LIST_LIMIT, useUpcomingEvents, type CalEvent } from "./api";
import { useCalendar } from "./calendar-store";
import type { ListedCalendar } from "./calendar-view";
import { addDays, dayKey, durationLabel, sameDay, startOfDay } from "./dates";
import { isPending, rangeLabel } from "./event-style";
import { useNow } from "./time-grid";

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
  const {
    data,
    isPending: loading,
    isError,
    refetch,
  } = useUpcomingEvents(
    {
      accountId: calendar.account.id,
      calendarId: calendar.info.id,
      writable: calendar.info.writable,
    },
    from,
  );
  const events = (data?.events ?? [])
    .filter(
      (e) =>
        e.accountId === calendar.account.id &&
        e.calendarId === calendar.info.id &&
        e.endMs > now.getTime(),
    )
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const days: { day: Date; events: CalEvent[] }[] = [];
  for (const event of events) {
    const day = startOfDay(new Date(Math.max(event.startMs, from)));
    const last = days[days.length - 1];
    if (last && dayKey(last.day) === dayKey(day)) last.events.push(event);
    else days.push({ day, events: [event] });
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border/60 animate-calendar-fade motion-reduce:animate-none">
      <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 pl-4 pr-2">
        {titleLeading}
        <span
          aria-hidden
          className="size-3.5 shrink-0 rounded-[4px]"
          style={{ background: color }}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {calendar.info.name}
        </span>
        <IconBtn label="Close" className="no-drag" onClick={() => setAgenda(null)}>
          <ChevronsLeftIcon />
        </IconBtn>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {days.map(({ day, events }) => (
          <section key={dayKey(day)} className="pt-3">
            <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {dayTitle(day, now)}
            </h3>
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => show(event)}
                style={{ "--event-color": color } as CSSProperties}
                className="flex w-full cursor-pointer gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-focus-ring"
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
                      "truncate text-[13px] font-medium text-foreground",
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
                        <span className="ml-1.5 text-muted-foreground/60">
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
        {/* At the list's limit, the year runs past what came back. */}
        {(data?.events.length ?? 0) >= LIST_LIMIT && days.length ? (
          <p className="px-2 pt-4 text-center text-xs text-muted-foreground">
            Showing what's coming until {dayTitle(days[days.length - 1]!.day, now)}.
          </p>
        ) : null}
        {isError || data?.failed.length ? (
          <div className="flex flex-col items-center gap-2 px-2 pt-6 text-center text-[13px] text-muted-foreground">
            Couldn&apos;t load this calendar&apos;s events.
            <button
              type="button"
              onClick={() => void refetch()}
              className={buttonClass("outline", "sm")}
            >
              Try again
            </button>
          </div>
        ) : !loading && !days.length ? (
          <p className="px-2 pt-6 text-center text-[13px] text-muted-foreground">
            Nothing coming up in the next year.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
