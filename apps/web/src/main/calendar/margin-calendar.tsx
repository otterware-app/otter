import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { NoteTarget } from "@otter/contracts/margin-notes";
import { Button, IconButton } from "@otter/ui/components/button";
import { SectionHead } from "@otter/ui/components/margin";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import { AgentNotes } from "../agent/agent-notes";
import { getAccountDisplayName } from "../mail/account-style";
import type { CalEvent } from "./api";
import { isShown, useCalendar } from "./calendar-store";
import { CALENDAR_MODES, type ListedCalendar } from "./calendar-view";
import { useNow } from "./time-grid";
import { DAY, addDays, durationLabel, timeLabel, weekNumber, type CalendarMode } from "./dates";

const KICKER = "font-mono text-2xs tracking-widest text-placeholder uppercase";

/** The Margin layout's head of the calendar: the month or the day, large, and how to move. */
export function MarginMasthead({
  mode,
  date,
  days,
  count,
  onMode,
  onToday,
  onStep,
}: {
  mode: CalendarMode;
  date: Date;
  days: Date[];
  /** The events on the day shown, in day mode. */
  count: number;
  onMode: (mode: CalendarMode) => void;
  onToday: () => void;
  onStep: (by: number) => void;
}) {
  const peek = useCalendar((s) => s.peek);
  const first = peek ?? days[0]!;
  const last = addDays(first, days.length - 1);
  const middle = mode === "week" ? addDays(first, 3) : mode === "month" ? date : first;
  const title =
    mode === "day"
      ? first.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })
      : middle.toLocaleDateString(undefined, { month: "long" });
  const kicker =
    mode === "day"
      ? `${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })} · ${count} ${count === 1 ? "event" : "events"}`
      : mode === "week"
        ? `Week ${weekNumber(middle)} · ${first.getDate()}–${last.getDate()}`
        : String(middle.getFullYear());
  return (
    <div className="flex shrink-0 items-baseline gap-4 pt-2 pb-5">
      <h1 className="font-reading text-3xl font-normal text-foreground">{title}</h1>
      <span className={KICKER}>{kicker}</span>
      <span className="min-w-0 flex-1" />
      <div className="no-drag flex items-center gap-0.5">
        {CALENDAR_MODES.map((m) => (
          <Button
            key={m.mode}
            size="sm"
            variant={m.mode === mode ? "ghost" : "ghost-muted"}
            aria-pressed={m.mode === mode}
            onClick={() => onMode(m.mode)}
          >
            {m.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost-muted" onClick={onToday}>
          Today
        </Button>
        <HintTooltip label="Previous" hint="←">
          <IconButton label="Previous" onClick={() => onStep(-1)}>
            <ChevronLeftIcon />
          </IconButton>
        </HintTooltip>
        <HintTooltip label="Next" hint="→">
          <IconButton label="Next" onClick={() => onStep(1)}>
            <ChevronRightIcon />
          </IconButton>
        </HintTooltip>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono text-2xs text-foreground tabular-nums">{value}</span>
    </div>
  );
}

const dayAndTime = (ms: number) =>
  `${new Date(ms).toLocaleDateString(undefined, { weekday: "short" })} ${timeLabel(new Date(ms))}`;

/**
 * Beside the grid when no event is open: what the days shown hold, what the agents wrote about
 * the events still to come, and the calendars.
 */
export function CalendarMargin({
  mode,
  days,
  events,
  calendars,
  colorOf,
}: {
  mode: CalendarMode;
  days: Date[];
  events: CalEvent[];
  calendars: ListedCalendar[];
  colorOf: (key: string) => string;
}) {
  const shown = useCalendar((s) => s.shown);
  const setShown = useCalendar((s) => s.setShown);
  const select = useCalendar((s) => s.select);
  const from = days[0]!.getTime();
  const to = addDays(days[days.length - 1]!, 1).getTime();
  const now = useNow().getTime();
  const inRange = events
    .filter((e) => e.endMs > from && e.startMs < to && !e.teammate && e.response !== "declined")
    .toSorted((a, b) => a.startMs - b.startMs);
  const timed = inRange.filter((e) => !e.allDay && e.endMs - e.startMs < DAY);
  const busy = timed.reduce((sum, e) => sum + (e.endMs - e.startMs), 0);
  const next = timed.find((e) => e.startMs >= now);
  const upcoming: NoteTarget[] = inRange
    .filter((e) => e.endMs >= now)
    .map((e) => ({ kind: "event", calendarId: e.calendarId, eventId: e.id }));
  return (
    <>
      <section>
        <SectionHead
          label={mode === "day" ? "This day" : mode === "week" ? "This week" : "This month"}
        />
        <Fact
          label="Events"
          value={busy ? `${timed.length} · ${durationLabel(busy)}` : String(timed.length)}
        />
        {inRange.length > timed.length ? (
          <Fact label="All day" value={String(inRange.length - timed.length)} />
        ) : null}
        {next ? (
          <button
            type="button"
            className="group/next mt-2 flex w-full cursor-pointer flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            onClick={() =>
              select({ accountId: next.accountId, calendarId: next.calendarId, id: next.id })
            }
          >
            <span className={cn(KICKER, "text-3xs")}>Next · {dayAndTime(next.startMs)}</span>
            <span className="w-full truncate font-reading text-md text-foreground group-hover/next:underline">
              {next.title}
            </span>
          </button>
        ) : null}
      </section>
      <AgentNotes target={upcoming.length ? upcoming : null} />
      {calendars.length ? (
        <section>
          <SectionHead label="Calendars" />
          {calendars.map((c) => {
            const on = isShown(shown, c.key, c.info.hiddenByDefault);
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => setShown(c.key, !on)}
                className="flex h-7 w-full cursor-pointer items-center gap-2.5 text-left text-body outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 border"
                  style={{ borderColor: colorOf(c.key), background: on ? colorOf(c.key) : "" }}
                />
                <span
                  className={cn("min-w-0 truncate", on ? "text-foreground" : "text-placeholder")}
                >
                  {c.info.primary ? getAccountDisplayName(c.account) : c.info.name}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
    </>
  );
}
