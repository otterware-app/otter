import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLatest } from "../use-latest";
import { getAccountColor, getAccountDisplayName } from "../mail/account-style";
import { isModClick } from "../keybindings/keys";
import { isTypingTarget } from "../mail/keyboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../mail/menu";
import type { MailAccount } from "../mail/types";
import { HintTooltip, IconBtn, buttonClass } from "../mail/ui";
import { hasGuests, useCalendarActions, useCalendarEvents, useTeamEvents } from "./api";
import { useCalendar } from "./calendar-store";
import {
  DAY,
  addDays,
  monthTitle,
  startOfDay,
  startOfWeek,
  step,
  visibleDays,
  type CalendarMode,
} from "./dates";
import { EventPanel } from "./event-panel";
import { TeamPicker } from "./team-picker";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";

export const CALENDAR_MODES: { mode: CalendarMode; label: string; key: string }[] = [
  { mode: "day", label: "Day", key: "D" },
  { mode: "week", label: "Week", key: "W" },
  { mode: "month", label: "Month", key: "M" },
];

/** The month in view; mid-scroll it follows the days going by, without re-rendering the grid. */
function CalendarTitle({
  mode,
  date,
  first: shown,
}: {
  mode: CalendarMode;
  date: Date;
  first: Date;
}) {
  const peek = useCalendar((s) => s.peek);
  const first = peek ?? shown;
  if (mode === "day")
    return (
      <h1 className="shrink-0 text-sm font-semibold text-foreground">
        {first.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        <span className="ml-2 font-normal text-muted-foreground">
          {first.toLocaleDateString(undefined, { weekday: "long" })}
        </span>
      </h1>
    );
  const middle = mode === "week" ? addDays(first, 3) : date;
  return <h1 className="shrink-0 text-sm font-semibold text-foreground">{monthTitle(middle)}</h1>;
}

/** Teammates' colors, apart from the mailboxes'. */
export const TEAM_COLORS = ["#34c759", "#af52de", "#ff9500", "#00c7be", "#ff2d55", "#5856d6"];

/** The mailboxes whose calendars the app can show. */
export const calendarAccounts = (accounts: MailAccount[]) =>
  accounts.filter((a) => a.capabilities?.calendar && !a.signedOut);

export function CalendarView({
  mode,
  accounts,
  titleLeading,
  titleTrailing,
  onMode,
}: {
  mode: CalendarMode;
  accounts: MailAccount[];
  titleLeading?: ReactNode;
  titleTrailing?: ReactNode;
  onMode: (mode: CalendarMode) => void;
}) {
  const date = useCalendar((s) => s.date);
  const setDate = useCalendar((s) => s.setDate);
  const hidden = useCalendar((s) => s.hidden);
  const selection = useCalendar((s) => s.selection);
  const draft = useCalendar((s) => s.draft);
  const select = useCalendar((s) => s.select);
  const actions = useCalendarActions();
  const bodyRef = useRef<HTMLDivElement>(null);

  const calendars = calendarAccounts(accounts);
  const shownIds = calendars.filter((a) => !hidden.includes(a.id)).map((a) => a.id);
  const free = useCalendar((s) => s.free);
  const setStart = useCalendar((s) => s.setStart);
  const setPeek = useCalendar((s) => s.setPeek);
  const days = useMemo(() => visibleDays(mode, date, free), [mode, date, free]);
  // Day and week scroll sideways: the grid holds days either side of those shown.
  const buffer = mode === "month" ? 0 : Math.max(7, days.length * 3);
  const strip = useMemo(
    () =>
      buffer
        ? Array.from({ length: days.length + buffer * 2 }, (_, i) => addDays(days[0], i - buffer))
        : days,
    [days, buffer],
  );
  const from = strip[0].getTime();
  const to = addDays(strip[strip.length - 1], 1).getTime();
  const stepGrid = useRef<((days: number) => void) | null>(null);
  const { data } = useCalendarEvents(shownIds, from, to);
  // Teammates (⌘P): their busy times over yours, each in a color of their own.
  const team = useCalendar((s) => s.team);
  const [picking, setPicking] = useState(false);
  const teamData = useTeamEvents(
    calendars.map((a) => a.id),
    team.map((t) => t.email),
    from,
    to,
  ).data;
  const events = [
    ...(data?.events ?? []).filter((e) => shownIds.includes(e.accountId)),
    ...(team.length ? (teamData?.events ?? []) : []),
  ];
  const colors = new Map<string, string>([
    ...calendars.map((a): [string, string] => [a.id, getAccountColor(a)]),
    ...team.map((t, i): [string, string] => [
      `team:${t.email}`,
      TEAM_COLORS[i % TEAM_COLORS.length]!,
    ]),
  ]);
  const colorOf = (id: string) => colors.get(id) ?? "#8a8a8a";
  const defaultAccountId = shownIds[0] ?? null;

  const selected =
    selection && !("draft" in selection)
      ? (events.find((e) => e.accountId === selection.accountId && e.id === selection.id) ?? null)
      : null;

  const go = (by: number) => {
    select(null);
    if (mode !== "month" && stepGrid.current) stepGrid.current(by * days.length);
    else setDate(step(mode, date, by));
  };
  const openDay = (day: Date) => {
    select(null);
    setDate(day);
    onMode("day");
  };

  // Notion Calendar's keys: T today, D W M the view, J K (or ← →) to step.
  // Today and the mini month glide there: the grid scrolls to the day, or,
  // from far off, starts a step short of it and scrolls the last step.
  const target = useCalendar((s) => s.target);
  const glide = useLatest((to: Date) => {
    select(null);
    const step = stepGrid.current;
    if (mode === "month" || !step) {
      setDate(to);
      return;
    }
    const aligned = (mode === "week" ? startOfWeek(to) : startOfDay(to)).getTime();
    const shift = Math.round((aligned - days[0].getTime()) / DAY);
    useCalendar.setState({ target: null });
    if (!shift) return;
    if (Math.abs(shift) <= buffer) {
      step(shift);
      return;
    }
    const lead = Math.sign(shift) * days.length;
    setStart(addDays(new Date(aligned), -lead));
    requestAnimationFrame(() => requestAnimationFrame(() => stepGrid.current?.(lead)));
  });
  useEffect(() => {
    if (target) glide.current(target);
  }, [target, glide]);
  const goToday = () => useCalendar.getState().goTo(new Date());

  const keys = useLatest({ go, onMode, goToday, selected, actions, select });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // ⌘P: a teammate's calendar over yours; Esc, with nothing open, takes them away.
      if (isModClick(e) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPicking(true);
        return;
      }
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !isTypingTarget(e) &&
        !useCalendar.getState().selection &&
        useCalendar.getState().team.length
      ) {
        e.preventDefault();
        useCalendar.getState().clearTeam();
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e)) return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog],[role=menu]")) return;
      const k = keys.current;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (key === "t") run(() => k.goToday());
      else if (key === "d") run(() => k.onMode("day"));
      else if (key === "w") run(() => k.onMode("week"));
      else if (key === "m") run(() => k.onMode("month"));
      else if (key === "j" || key === "arrowright") run(() => k.go(1));
      else if (key === "k" || key === "arrowleft") run(() => k.go(-1));
      else if ((key === "backspace" || key === "delete") && k.selected) {
        const event = k.selected;
        const mine =
          !event.organizer || event.organizer.toLowerCase() === event.accountId.toLowerCase();
        run(() => {
          k.actions.remove(event, hasGuests(event) && mine);
          k.select(null);
        });
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [keys]);

  const failed = (data?.failed ?? []).flatMap((f) => {
    const account = calendars.find((a) => a.id === f.accountId);
    return account ? [{ ...f, name: getAccountDisplayName(account) }] : [];
  });
  // A Gmail sign-in from before teammates' availability needs to sign in again for it.
  const teamBlocked = [
    ...new Set(
      (team.length ? (teamData?.schedules ?? []) : [])
        .filter((s) => s.error === "noAccess")
        .flatMap((s) => {
          const account = calendars.find((a) => a.id === s.accountId);
          return account ? [getAccountDisplayName(account)] : [];
        }),
    ),
  ];
  const modeLabel = CALENDAR_MODES.find((m) => m.mode === mode)!.label;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-calendar="">
      <div
        data-toolbar=""
        className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
      >
        {titleLeading}
        <CalendarTitle mode={mode} date={date} first={days[0]} />
        {failed.length ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {failed
              .map((f) =>
                f.error === "noAccess"
                  ? `Sign in to ${f.name} again to show its calendar`
                  : `Couldn't load ${f.name}'s calendar`,
              )
              .join(" · ")}
          </span>
        ) : null}
        {teamBlocked.length ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            Sign in to {teamBlocked.join(", ")} again to see teammates&apos; availability
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={buttonClass("ghost", "sm", "no-drag gap-1 px-2")}>
              {modeLabel}
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            {CALENDAR_MODES.map((m) => (
              <DropdownMenuItem
                key={m.mode}
                accelerator={m.key}
                icon={m.mode === mode ? <CheckIcon /> : <span className="size-4" />}
                onSelect={() => onMode(m.mode)}
              >
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <HintTooltip label="Today" hint="T">
          <button
            type="button"
            onClick={() => {
              goToday();
            }}
            className={buttonClass("outline", "sm", "no-drag")}
          >
            Today
          </button>
        </HintTooltip>
        <div className="no-drag flex items-center">
          <HintTooltip label="Previous" hint="K">
            <IconBtn label="Previous" onClick={() => go(-1)}>
              <ChevronLeftIcon />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label="Next" hint="J">
            <IconBtn label="Next" onClick={() => go(1)}>
              <ChevronRightIcon />
            </IconBtn>
          </HintTooltip>
        </div>
        {titleTrailing}
      </div>

      <div
        ref={bodyRef}
        // Within the card's rounded corners: the grid's sticky parts are opaque.
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-xl"
        onPointerDown={(e) => {
          if (!(e.target as HTMLElement).closest("[data-event]")) select(null);
        }}
      >
        {calendars.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            None of your mailboxes has a calendar Otter Mail can open. Gmail and Outlook do.
          </div>
        ) : (
          <div
            key={mode === "month" ? `${mode}:${from}` : mode}
            className="flex min-h-0 flex-1 flex-col animate-calendar-in motion-reduce:animate-none"
          >
            {mode === "month" ? (
              <MonthGrid
                days={days}
                month={date.getMonth()}
                events={events}
                colorOf={colorOf}
                defaultAccountId={defaultAccountId}
                onOpenDay={openDay}
              />
            ) : (
              <TimeGrid
                days={strip}
                visible={days.length}
                buffer={buffer}
                stepRef={stepGrid}
                onSettle={(shift) => setStart(addDays(days[0], shift))}
                onPeek={(shift) => setPeek(shift ? addDays(days[0], shift) : null)}
                events={events}
                colorOf={colorOf}
                defaultAccountId={defaultAccountId}
                actions={actions}
                onOpenDay={openDay}
              />
            )}
          </div>
        )}
        {selected || (draft && selection && "draft" in selection) ? (
          <EventPanel
            containerRef={bodyRef}
            event={selected}
            draft={selected ? null : draft}
            accounts={calendars}
            colorOf={colorOf}
            actions={actions}
          />
        ) : null}
        {picking ? <TeamPicker onClose={() => setPicking(false)} /> : null}
      </div>
    </div>
  );
}
