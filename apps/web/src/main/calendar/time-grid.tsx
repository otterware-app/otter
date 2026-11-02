import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
} from "react";
import { useLatest } from "../use-latest";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "../mail/ui";
import { eventTimes, hasGuests, type CalEvent, type useCalendarActions, calendarKey } from "./api";
import { useCalendar } from "./calendar-store";
import {
  DAY,
  HOUR,
  MINUTE,
  addDays,
  hourLabel,
  minutesOfDay,
  sameDay,
  timeLabel,
  weekdayShort,
} from "./dates";
import { eventStyle, isPending, rangeLabel } from "./event-style";

export const HOUR_PX = 48;
const SNAP = 15;
const GUTTER = "w-14";
const GUTTER_PX = 56;

type Actions = ReturnType<typeof useCalendarActions>;

export const eventKey = (e: Pick<CalEvent, "accountId" | "calendarId" | "id">) =>
  `${e.accountId}|${e.calendarId}|${e.id}`;

/** Side by side where they overlap: each cluster's events share its width in columns. */
function layoutDay(events: CalEvent[]): Map<CalEvent, { col: number; cols: number }> {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const placed = new Map<CalEvent, { col: number; cols: number }>();
  let cluster: CalEvent[] = [];
  let columns: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const e of cluster) placed.get(e)!.cols = columns.length;
    cluster = [];
    columns = [];
  };
  for (const e of sorted) {
    const end = Math.max(e.endMs, e.startMs + 20 * MINUTE);
    if (e.startMs >= clusterEnd) close();
    let col = columns.findIndex((until) => until <= e.startMs);
    if (col < 0) col = columns.push(end) - 1;
    else columns[col] = end;
    placed.set(e, { col, cols: 0 });
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return placed;
}

type Gesture =
  | { kind: "create"; day: number; anchor: number; moved: boolean }
  | {
      kind: "move" | "resize";
      event: CalEvent;
      x: number;
      y: number;
      day: number;
      minute: number;
      moved: boolean;
    };

export function TimeGrid({
  days,
  visible,
  buffer,
  stepRef,
  onSettle,
  onPeek,
  events,
  colorOf,
  defaultCalendar,
  actions,
  onOpenDay,
}: {
  /** Every day laid out: `buffer` either side of the `visible` ones shown. */
  days: Date[];
  visible: number;
  buffer: number;
  /** Glides by whole days (the ‹ › buttons, J and K). */
  stepRef: MutableRefObject<((days: number) => void) | null>;
  /** Scrolling came to rest this many days from the first shown. */
  onSettle: (shift: number) => void;
  /** Mid-scroll, a day went by: this many days from the first shown now lead. */
  onPeek: (shift: number) => void;
  events: CalEvent[];
  colorOf: (accountId: string) => string;
  /** Where a new event goes. */
  defaultCalendar: { accountId: string; calendarId: string } | null;
  actions: Actions;
  onOpenDay: (day: Date) => void;
}) {
  const selection = useCalendar((s) => s.selection);
  const draft = useCalendar((s) => s.draft);
  const select = useCalendar((s) => s.select);
  const setDraft = useCalendar((s) => s.setDraft);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{ key: string; startMs: number; endMs: number } | null>(
    null,
  );
  const now = useNow();

  // A day's width: what's beside the hours, shared by the days shown.
  const [colW, setColW] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setColW((el.clientWidth - GUTTER_PX) / visible));
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  // Sideways, Notion Calendar's way: it scrolls freely, rests on a day, and
  // the strip re-centres on where it rested, so it never runs out.
  const firstDay = days[0].getTime();
  useLayoutEffect(() => {
    if (scrollRef.current && colW) scrollRef.current.scrollLeft = buffer * colW;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new first day is the trigger: re-centre.
  }, [firstDay, colW, buffer]);
  const onSettleRef = useLatest(onSettle);
  const onPeekRef = useLatest(onPeek);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !colW) return;
    let timer: ReturnType<typeof setTimeout>;
    let peeked = 0;
    // Where a glide is headed: steps taken mid-glide add up from there.
    let aim: number | null = null;
    const scroll = () => {
      // Only a day passing is news, not every pixel.
      const leading = Math.round(el.scrollLeft / colW) - buffer;
      if (leading !== peeked) {
        peeked = leading;
        onPeekRef.current(leading);
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        // At rest between days: glide onto the nearest, then settle there.
        // (Not CSS snapping: a mouse wheel's steps would each be pulled back.)
        const nearest = Math.round(el.scrollLeft / colW) * colW;
        if (Math.abs(nearest - el.scrollLeft) > 1) {
          el.scrollTo({ left: nearest, behavior: "smooth" });
          return;
        }
        aim = null;
        const shift = Math.round(el.scrollLeft / colW) - buffer;
        if (shift) onSettleRef.current(shift);
      }, 140);
    };
    el.addEventListener("scroll", scroll, { passive: true });
    stepRef.current = (n) => {
      const max = el.scrollWidth - el.clientWidth;
      aim = Math.min(max, Math.max(0, (aim ?? el.scrollLeft) + n * colW));
      el.scrollTo({ left: aim, behavior: "smooth" });
    };
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", scroll);
      stepRef.current = null;
    };
  }, [colW, buffer, stepRef, onSettleRef, onPeekRef]);

  // Opens on the working day: the hour before now, or 8 AM.
  const [openingHour] = useState(() => {
    const today = new Date();
    return days.some((d) => sameDay(d, today)) ? Math.max(0, today.getHours() - 2) : 8;
  });
  useLayoutEffect(() => {
    const scroll = () => {
      if (scrollRef.current) scrollRef.current.scrollTop = openingHour * HOUR_PX;
    };
    scroll();
    // The scroll area measures itself after mounting; again once it has.
    const frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [openingHour]);

  const timed = events.filter((e) => !e.allDay && e.endMs - e.startMs < DAY);
  const allDay = events.filter((e) => e.allDay || e.endMs - e.startMs >= DAY);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = columnsRef.current!.getBoundingClientRect();
    const day = Math.min(
      days.length - 1,
      Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * days.length)),
    );
    const raw = ((clientY - rect.top) / HOUR_PX) * 60;
    const minute = Math.min(24 * 60, Math.max(0, raw));
    return { day, minute };
  };
  const snap = (minute: number) => Math.round(minute / SNAP) * SNAP;
  const at = (day: number, minute: number) => days[day].getTime() + minute * MINUTE;

  const onColumnsDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !defaultCalendar) return;
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    // A click away from an open event only closes it.
    if (useCalendar.getState().selection) return;
    const { day, minute } = pointAt(e.clientX, e.clientY);
    const anchor = Math.floor(minute / SNAP) * SNAP;
    gesture.current = { kind: "create", day, anchor, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onEventDown = (e: PointerEvent<HTMLElement>, event: CalEvent, resize: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // A teammate's, or on a calendar it can't change: only to look at.
    if (event.readOnly) {
      select({ accountId: event.accountId, calendarId: event.calendarId, id: event.id });
      return;
    }
    const { day, minute } = pointAt(e.clientX, e.clientY);
    gesture.current = {
      kind: resize ? "resize" : "move",
      event,
      x: e.clientX,
      y: e.clientY,
      day,
      minute,
      moved: false,
    };
    columnsRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const { day, minute } = pointAt(e.clientX, e.clientY);
    if (g.kind === "create") {
      if (!g.moved && day === g.day && Math.abs(minute - g.anchor) < SNAP / 2) return;
      g.moved = true;
      // From the slot pressed to the one under the pointer, across days too.
      const anchor = at(g.day, g.anchor);
      const point = at(day, snap(minute));
      const [startMs, endMs] = point > anchor ? [anchor, point] : [point, anchor + SNAP * MINUTE];
      // Drawn now, opened on release.
      useCalendar.setState({
        draft: {
          ...useCalendar.getState().draft,
          ...defaultCalendar!,
          startMs,
          endMs,
          allDay: false,
        },
        selection: null,
      });
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
    g.moved = true;
    const { event } = g;
    const delta = snap(minute - g.minute) * MINUTE;
    if (g.kind === "move") {
      // By the days' dates: hidden weekends lie between columns.
      const shift = delta + (days[day].getTime() - days[g.day].getTime());
      setPreview({
        key: eventKey(event),
        startMs: event.startMs + shift,
        endMs: event.endMs + shift,
      });
    } else {
      // The end follows the pointer, onto later days too.
      const endMs = Math.max(event.startMs + SNAP * MINUTE, at(day, snap(minute)));
      setPreview({ key: eventKey(event), startMs: event.startMs, endMs });
    }
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "create") {
      if (g.moved) select({ draft: true });
      else {
        const start = Math.floor(g.anchor / 30) * 30;
        setDraft({
          ...defaultCalendar!,
          startMs: at(g.day, start),
          endMs: at(g.day, Math.min(start + 60, 24 * 60)),
          allDay: false,
        });
      }
      return;
    }
    if (!g.moved) {
      select({ accountId: g.event.accountId, calendarId: g.event.calendarId, id: g.event.id });
      return;
    }
    const moved = preview;
    setPreview(null);
    if (!moved || (moved.startMs === g.event.startMs && moved.endMs === g.event.endMs)) return;
    actions.update(g.event, eventTimes(moved.startMs, moved.endMs, false), hasGuests(g.event));
  };

  const selectedKey = selection && !("draft" in selection) ? eventKey(selection) : null;
  const todayIndex = days.findIndex((d) => sameDay(d, now));

  const stripWidth = colW * days.length;
  return (
    <ScrollArea ref={scrollRef} className="min-h-0 flex-1" viewportClassName="overscroll-contain">
      <div
        className="relative"
        style={{ width: GUTTER_PX + stripWidth, visibility: colW ? undefined : "hidden" }}
      >
        {/* Day names and the all-day row stay on top; the corner, on both. */}
        <div className="sticky top-0 z-30 flex border-b border-border/60 bg-canvas">
          <div
            className={cn(
              GUTTER,
              "sticky left-0 z-10 flex shrink-0 items-end justify-end bg-canvas pb-1.5 pr-2",
            )}
          >
            <span className="text-[10px] text-muted-foreground/80">{zoneLabel()}</span>
          </div>
          <div className="flex flex-col" style={{ width: stripWidth }}>
            <div className="flex">
              {days.map((day) => {
                const today = sameDay(day, now);
                return (
                  <button
                    key={day.getTime()}
                    type="button"
                    onClick={() => onOpenDay(day)}
                    style={{ width: colW }}
                    className="flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 text-[13px] outline-none"
                  >
                    <span
                      className={today ? "font-medium text-foreground" : "text-muted-foreground"}
                    >
                      {weekdayShort(day)}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 tabular-nums",
                        today
                          ? "bg-(--calendar-today) font-medium text-white"
                          : "text-muted-foreground",
                      )}
                    >
                      {day.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
            <AllDayRow
              days={days}
              events={allDay}
              colorOf={colorOf}
              selectedKey={selectedKey}
              onSelect={(event) =>
                select({ accountId: event.accountId, calendarId: event.calendarId, id: event.id })
              }
            />
          </div>
        </div>

        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          {/* Hours: the label sits on its line; the column stays as days slide under. */}
          <div className={cn(GUTTER, "sticky left-0 z-20 shrink-0 select-none bg-canvas")}>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground/80"
                style={{ top: hour * HOUR_PX }}
              >
                {hourLabel(hour)}
              </span>
            ))}
            {todayIndex >= 0 ? (
              <span
                className="absolute right-1 z-10 -translate-y-1/2 rounded-[4px] bg-(--calendar-today) px-1 py-px text-[10px] font-medium tabular-nums text-white"
                style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }}
              >
                {timeLabel(now)}
              </span>
            ) : null}
          </div>

          <div
            ref={columnsRef}
            className="relative flex shrink-0 select-none"
            style={{ width: stripWidth }}
            onPointerDown={onColumnsDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              gesture.current = null;
              setPreview(null);
            }}
          >
            {/* Hour lines. */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border/50"
                  style={{ top: hour * HOUR_PX }}
                />
              ))}
            </div>
            {days.map((day, i) => {
              const dayStart = day.getTime();
              const dayEnd = dayStart + DAY;
              const shown = timed
                .map((e) => {
                  const p = preview?.key === eventKey(e) ? preview : null;
                  return p ? { ...e, startMs: p.startMs, endMs: p.endMs } : e;
                })
                .filter((e) => e.endMs > dayStart && e.startMs < dayEnd);
              const layout = layoutDay(shown);
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={dayStart}
                  style={{ width: colW }}
                  className={cn(
                    "relative shrink-0 border-l border-border/50",
                    weekend && "bg-foreground/[0.015]",
                  )}
                >
                  {shown.map((event) => {
                    const { col, cols } = layout.get(event)!;
                    const key = eventKey(event);
                    return (
                      <TimedEvent
                        key={key}
                        event={event}
                        dayStart={dayStart}
                        col={col}
                        cols={cols}
                        color={colorOf(calendarKey(event))}
                        selected={key === selectedKey}
                        dragging={preview?.key === key}
                        onPointerDown={onEventDown}
                      />
                    );
                  })}
                  {draft && !draft.allDay && draft.endMs > dayStart && draft.startMs < dayEnd ? (
                    <DraftBlock
                      title={draft.startMs >= dayStart ? draft.title : undefined}
                      startMs={Math.max(draft.startMs, dayStart)}
                      endMs={Math.min(draft.endMs, dayEnd)}
                      label={
                        draft.startMs >= dayStart ? rangeLabel(draft.startMs, draft.endMs) : null
                      }
                      dayStart={dayStart}
                      color={colorOf(calendarKey(draft))}
                    />
                  ) : null}
                  {i === todayIndex ? <NowLine now={now} strong /> : null}
                </div>
              );
            })}
            {todayIndex >= 0 ? <NowLine now={now} /> : null}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

function TimedEvent({
  event,
  dayStart,
  col,
  cols,
  color,
  selected,
  dragging,
  onPointerDown,
}: {
  event: CalEvent;
  dayStart: number;
  col: number;
  cols: number;
  color: string;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>, event: CalEvent, resize: boolean) => void;
}) {
  const start = Math.max(event.startMs, dayStart);
  const end = Math.min(event.endMs, dayStart + DAY);
  const top = ((start - dayStart) / HOUR) * HOUR_PX;
  const height = Math.max(((end - start) / HOUR) * HOUR_PX, 18);
  const short = height < 36;
  const declined = event.response === "declined";
  return (
    <div
      data-event=""
      data-event-key={eventKey(event)}
      onPointerDown={(e) => onPointerDown(e, event, false)}
      style={{
        ...eventStyle(color, event, selected),
        top: top + 1,
        height: height - 2,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 5px)`,
      }}
      className={cn(
        "group/event absolute flex cursor-default overflow-hidden rounded-[5px] border text-[11px] leading-[14px]",
        isPending(event) && !selected && "border-dashed",
        declined && !selected && "opacity-55",
        dragging
          ? "z-20 shadow-[0_8px_24px_-8px_rgb(0_0_0/45%)]"
          : "transition-[top,height,left,width,background-color,color] duration-150 ease-out",
        selected && "z-10",
      )}
    >
      {!isPending(event) && !selected ? (
        <span aria-hidden className="w-[3px] shrink-0 bg-(--event-color)" />
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-1 px-1.5",
          short ? "items-center gap-1.5" : "flex-col pt-[3px]",
        )}
      >
        <span
          className={cn(
            "min-w-0 font-medium",
            short ? "truncate" : "line-clamp-2",
            declined && "line-through",
            !selected && "text-foreground",
          )}
        >
          {event.title}
        </span>
        <span
          className={cn(
            "shrink-0 truncate tabular-nums",
            selected
              ? "opacity-80"
              : "text-[color-mix(in_srgb,var(--event-color)_75%,var(--color-foreground))]",
          )}
        >
          {short ? timeLabel(new Date(event.startMs)) : rangeLabel(event.startMs, event.endMs)}
        </span>
      </div>
      {/* The bottom edge stretches it (where it can be changed). */}
      {event.readOnly ? null : (
        <div
          aria-hidden
          onPointerDown={(e) => onPointerDown(e, event, true)}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
        />
      )}
    </div>
  );
}

/** The event being drawn: a soft wash of its calendar's color, as Notion Calendar draws it. */
function DraftBlock({
  title,
  label,
  startMs,
  endMs,
  dayStart,
  color,
}: {
  title?: string;
  label: string | null;
  startMs: number;
  endMs: number;
  dayStart: number;
  color: string;
}) {
  const top = ((startMs - dayStart) / HOUR) * HOUR_PX;
  const height = Math.max(((endMs - startMs) / HOUR) * HOUR_PX, 12);
  return (
    <div
      data-event=""
      data-event-key="draft"
      style={{
        top,
        height,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
      }}
      className="absolute inset-x-0 z-20 flex flex-col overflow-hidden px-1.5 pt-[3px] text-[11px] leading-[14px] transition-[top,height] duration-100 ease-out"
    >
      {title?.trim() ? <span className="truncate font-medium text-foreground">{title}</span> : null}
      {label ? (
        <span
          className="tabular-nums"
          style={{ color: `color-mix(in srgb, ${color} 75%, var(--color-foreground))` }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

function NowLine({ now, strong = false }: { now: Date; strong?: boolean }) {
  const top = (minutesOfDay(now) / 60) * HOUR_PX;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0", strong ? "z-30" : "z-0")}
      style={{ top }}
    >
      <div
        className={cn(
          "-translate-y-1/2 bg-(--calendar-today)",
          strong ? "h-[2px]" : "h-px opacity-40",
        )}
      />
      {strong ? (
        <span className="absolute -left-[3px] top-0 h-2.5 w-[3px] -translate-y-1/2 rounded-full bg-(--calendar-today)" />
      ) : null}
    </div>
  );
}

function AllDayRow({
  days,
  events,
  colorOf,
  selectedKey,
  onSelect,
}: {
  days: Date[];
  events: CalEvent[];
  colorOf: (accountId: string) => string;
  selectedKey: string | null;
  onSelect: (event: CalEvent) => void;
}) {
  const first = days[0].getTime();
  const last = addDays(days[days.length - 1], 1).getTime();
  const lanes: number[] = [];
  const bars = events
    .filter((e) => e.endMs > first && e.startMs < last)
    .sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs)
    .flatMap((event) => {
      // The columns it covers (by date: a day across a clock change is 23 or
      // 25 hours long, and hidden weekends lie between columns).
      const from = days.findIndex((d) => addDays(d, 1).getTime() > event.startMs);
      const to = days.filter((d) => d.getTime() < event.endMs).length;
      // Only on hidden days.
      if (from < 0 || to <= from) return [];
      let lane = lanes.findIndex((until) => until <= from);
      if (lane < 0) lane = lanes.push(to) - 1;
      else lanes[lane] = to;
      return [{ event, from, to, lane }];
    });
  return (
    <div className="relative" style={{ height: lanes.length * 22 + (lanes.length ? 6 : 4) }}>
      {bars.map(({ event, from, to, lane }) => {
        const key = eventKey(event);
        const selected = key === selectedKey;
        return (
          <button
            key={key}
            type="button"
            data-event=""
            data-event-key={key}
            onClick={() => onSelect(event)}
            style={{
              ...eventStyle(colorOf(calendarKey(event)), event, selected),
              top: lane * 22 + 2,
              left: `calc(${(from / days.length) * 100}% + 2px)`,
              width: `calc(${((to - from) / days.length) * 100}% - 5px)`,
            }}
            className={cn(
              "absolute flex h-5 cursor-default items-center gap-1.5 overflow-hidden rounded-[5px] border px-1.5 text-left text-[11px] font-medium transition-colors duration-150",
              isPending(event) && !selected && "border-dashed",
              !selected && "text-foreground",
            )}
          >
            {!isPending(event) && !selected ? (
              <span aria-hidden className="-ml-1.5 h-full w-[3px] shrink-0 bg-(--event-color)" />
            ) : null}
            <span className="truncate">{event.title}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The time now, a minute at a time. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, []);
  return now;
}

function zoneLabel(): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}
