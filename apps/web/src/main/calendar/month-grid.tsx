import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "../mail/ui";
import type { CalEvent } from "./api";
import { useCalendar } from "./calendar-store";
import { DAY, sameDay, timeLabel, weekdayShort } from "./dates";
import { eventStyle, isPending } from "./event-style";
import { eventKey, useNow } from "./time-grid";

const ROW_PX = 22;

export function MonthGrid({
  days,
  month,
  events,
  colorOf,
  defaultAccountId,
  onOpenDay,
}: {
  days: Date[];
  month: number;
  events: CalEvent[];
  colorOf: (accountId: string) => string;
  defaultAccountId: string | null;
  onOpenDay: (day: Date) => void;
}) {
  const selection = useCalendar((s) => s.selection);
  const select = useCalendar((s) => s.select);
  const setDraft = useCalendar((s) => s.setDraft);
  const draft = useCalendar((s) => s.draft);
  const now = useNow();
  const weeks = days.length / 7;
  const selectedKey = selection && !("draft" in selection) ? eventKey(selection) : null;

  // How many rows of events fit in a day, from the grid's height.
  const gridRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(4);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const cell = el.clientHeight / weeks;
      setFit(Math.max(1, Math.floor((cell - 30) / ROW_PX)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [weeks]);

  const sorted = [...events].sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs || b.endMs - a.endMs,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-border/60">
        {days.slice(0, 7).map((day) => (
          <div
            key={day.getDay()}
            className="flex h-9 items-center justify-center text-[13px] text-muted-foreground"
          >
            {weekdayShort(day)}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {days.map((day, i) => {
          const start = day.getTime();
          const end = start + DAY;
          const today = sameDay(day, now);
          const outside = day.getMonth() !== month;
          const dayEvents = sorted.filter((e) => e.endMs > start && e.startMs < end);
          const overflow = dayEvents.length > fit;
          const shown = overflow ? dayEvents.slice(0, fit - 1) : dayEvents;
          const draftHere = draft && draft.startMs >= start && draft.startMs < end;
          return (
            <div
              key={start}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-event]") || !defaultAccountId) return;
                setDraft({
                  accountId: defaultAccountId,
                  startMs: start + 9 * 3_600_000,
                  endMs: start + 10 * 3_600_000,
                  allDay: false,
                });
              }}
              className={cn(
                "flex min-h-0 min-w-0 flex-col gap-px overflow-hidden px-1 pb-1",
                i % 7 !== 0 && "border-l border-border/50",
                i >= 7 && "border-t border-border/50",
                (day.getDay() === 0 || day.getDay() === 6) && "bg-foreground/[0.015]",
              )}
            >
              <div className="flex h-7 shrink-0 items-center justify-end">
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className={cn(
                    "flex h-5 min-w-5 cursor-pointer items-center justify-center rounded-[5px] px-1 text-[12px] tabular-nums outline-none transition-colors",
                    today
                      ? "bg-(--calendar-today) font-medium text-white"
                      : outside
                        ? "text-muted-foreground/50 hover:text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {day.getDate() === 1 && !today
                    ? day.toLocaleDateString(undefined, { month: "long", day: "numeric" })
                    : day.getDate()}
                </button>
              </div>
              {shown.map((event) => {
                const key = eventKey(event);
                const selected = key === selectedKey;
                const solid = event.allDay || event.endMs - event.startMs >= DAY;
                return (
                  <button
                    key={key}
                    type="button"
                    data-event=""
                    data-event-key={key}
                    onClick={() => select({ accountId: event.accountId, id: event.id })}
                    style={
                      solid || selected
                        ? eventStyle(colorOf(event.accountId), event, selected)
                        : ({ "--event-color": colorOf(event.accountId) } as CSSProperties)
                    }
                    className={cn(
                      "flex h-5 shrink-0 cursor-default items-center gap-1.5 overflow-hidden rounded-[5px] border border-transparent px-1 text-left text-[11px] transition-colors duration-150",
                      solid && isPending(event) && !selected && "border-dashed",
                      !solid && !selected && "hover:bg-foreground/[0.05]",
                      outside && !selected && "opacity-60",
                      event.response === "declined" && "line-through opacity-50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-3 w-[3px] shrink-0 rounded-full",
                        isPending(event) && !solid
                          ? "border border-(--event-color)"
                          : "bg-(--event-color)",
                        selected && "bg-current",
                      )}
                    />
                    {solid ? null : (
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          selected ? "opacity-80" : "text-muted-foreground",
                        )}
                      >
                        {timeLabel(new Date(event.startMs))}
                      </span>
                    )}
                    <span className={cn("truncate font-medium", !selected && "text-foreground")}>
                      {event.title}
                    </span>
                  </button>
                );
              })}
              {draftHere ? (
                <div
                  data-event=""
                  data-event-key="draft"
                  style={eventStyle(colorOf(draft.accountId), { response: null }, true)}
                  className="flex h-5 shrink-0 items-center rounded-[5px] border px-1.5 text-[11px] font-medium"
                >
                  <span className="truncate">{draft.title?.trim() || "New event"}</span>
                </div>
              ) : null}
              {overflow ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="h-5 shrink-0 cursor-pointer rounded-[5px] px-1 text-left text-[11px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                >
                  {dayEvents.length - shown.length} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
