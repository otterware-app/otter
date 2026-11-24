import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useLatest } from "../use-latest";
import { AllowAccessButton } from "../mail/allow-access";
import { getAccountColor, getAccountDisplayName } from "../mail/account-style";
import { isModClick } from "../keybindings/keys";
import { isTypingTarget } from "../mail/keyboard";
import type { MailAccount } from "../mail/types";
import { useAccounts } from "../mail/hooks";
import {
  calendarKey,
  useCachedEvent,
  hasGuests,
  useCalendarActions,
  useCalendarEvents,
  useCalendarLists,
  useSyncWhileShown,
  useTeamEvents,
  type AccountCalendars,
  type CalendarInfo,
} from "./api";
import { isShown, useCalendar } from "./calendar-store";
import { useCalendarPreferences } from "./preferences";
import {
  DAY,
  addDays,
  monthTitle,
  sameDay,
  startOfDay,
  startOfWeek,
  step,
  stepDays,
  visibleDays,
  type CalendarMode,
} from "./dates";
import { AgendaDrawer } from "./agenda";
import { EventPanel } from "./event-panel";
import { TeamPicker } from "./team-picker";
import { MonthGrid } from "./month-grid";
import { TimeGrid } from "./time-grid";
import { CalendarMargin, MarginMasthead } from "./margin-calendar";
import { useAppLayout } from "../theme/interface-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { Button, IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";

export const CALENDAR_MODES: { mode: CalendarMode; label: string }[] = [
  { mode: "day", label: "Day" },
  { mode: "week", label: "Week" },
  { mode: "month", label: "Month" },
];

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
      <h1 className="shrink-0 text-sm font-semibold text-foreground font-reading">
        {first.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        <span className="ml-2 font-normal text-muted-foreground">
          {first.toLocaleDateString(undefined, { weekday: "long" })}
        </span>
      </h1>
    );
  const middle = mode === "week" ? addDays(first, 3) : date;
  return <h1 className="shrink-0 text-sm font-semibold text-foreground">{monthTitle(middle)}</h1>;
}

/** Where new events go: the calendar picked in the sidebar, else the first primary one that takes them. */
export function defaultCalendarOf(
  calendars: ListedCalendar[],
  chosen: string,
): ListedCalendar | undefined {
  const writable = calendars.filter((c) => c.info.writable);
  return (
    writable.find((c) => c.key === chosen) ?? writable.find((c) => c.info.primary) ?? writable[0]
  );
}

/** Where new events go, among the calendars the Calendar shows. */
export function useDefaultCalendar(): { accountId: string; calendarId: string } | null {
  const accounts = calendarAccounts(useAccounts().data ?? []);
  const { defaultCalendar, colors } = useCalendarPreferences();
  const shown = useCalendar((s) => s.shown);
  const lists = useCalendarLists(accounts.map((a) => a.id)).data;
  const visible = listedCalendars(accounts, lists, colors).filter((c) =>
    isShown(shown, c.key, c.info.hiddenByDefault),
  );
  const target = defaultCalendarOf(visible, defaultCalendar);
  return target ? { accountId: target.account.id, calendarId: target.info.id } : null;
}

/** A near-black calendar color (a mailbox colored black) lifted toward the text, so it reads on a dark canvas. */
export function legible(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance < 0.12 ? `color-mix(in srgb, ${hex} 45%, var(--color-foreground))` : hex;
}

export const TEAM_COLORS = ["#34c759", "#af52de", "#ff9500", "#00c7be", "#ff2d55", "#5856d6"];

export type ListedCalendar = {
  account: MailAccount;
  info: CalendarInfo;
  key: string;
  color: string;
};

export function listedCalendars(
  accounts: MailAccount[],
  lists: AccountCalendars[] | undefined,
  colors: Record<string, string> = {},
): ListedCalendar[] {
  return accounts.flatMap((account) =>
    (lists?.find((l) => l.accountId === account.id)?.calendars ?? []).map((info) => {
      const key = calendarKey({ accountId: account.id, calendarId: info.id });
      return {
        account,
        info,
        key,
        color: colors[key] ?? (info.primary || !info.color ? getAccountColor(account) : info.color),
      };
    }),
  );
}

export const calendarAccounts = (accounts: MailAccount[]) =>
  accounts.filter((a) => a.capabilities?.calendar && !a.signedOut);

function AllowCalendarAccess({ accounts }: { accounts: MailAccount[] }) {
  const names = accounts.map(getAccountDisplayName);
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        {accounts.length === 1
          ? `${names[0]} needs your permission to show all its calendars`
          : `${names.join(", ")} need your permission to show all their calendars`}
      </span>
      {accounts.map((account) => (
        <AllowAccessButton
          key={account.id}
          account={account}
          label={accounts.length === 1 ? "Allow access" : `Allow ${getAccountDisplayName(account)}`}
          className="h-6 px-2 text-xs"
        />
      ))}
    </span>
  );
}

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
  const shown = useCalendar((s) => s.shown);
  const selection = useCalendar((s) => s.selection);
  const draft = useCalendar((s) => s.draft);
  const select = useCalendar((s) => s.select);
  const actions = useCalendarActions();
  const bodyRef = useRef<HTMLDivElement>(null);
  const margin = useAppLayout() === "margin";
  useSyncWhileShown();

  const {
    showWeekends,
    showDeclined,
    defaultCalendar: chosenDefault,
    colors: chosenColors,
  } = useCalendarPreferences();
  const calendars = calendarAccounts(accounts);
  const lists = useCalendarLists(calendars.map((a) => a.id)).data;
  const listed = listedCalendars(calendars, lists, chosenColors);
  const visible = listed.filter((c) => isShown(shown, c.key, c.info.hiddenByDefault));
  const refs = visible.map((c) => ({
    accountId: c.account.id,
    calendarId: c.info.id,
    writable: c.info.writable,
  }));
  const visibleKeys = new Set(visible.map((c) => c.key));
  const free = useCalendar((s) => s.free);
  const setStart = useCalendar((s) => s.setStart);
  const setPeek = useCalendar((s) => s.setPeek);
  const weekends = showWeekends || mode === "day";
  const days = visibleDays(mode, date, free, weekends);
  const buffer = mode === "month" ? 0 : Math.max(7, days.length * 3);
  const strip = buffer
    ? Array.from({ length: days.length + buffer * 2 }, (_, i) =>
        stepDays(days[0], i - buffer, weekends),
      )
    : days;
  const from = strip[0].getTime();
  const to = addDays(strip[strip.length - 1], 1).getTime();
  const stepGrid = useRef<((days: number) => void) | null>(null);
  const { data } = useCalendarEvents(refs, from, to);
  const team = useCalendar((s) => s.team);
  const [picking, setPicking] = useState(false);
  const teamData = useTeamEvents(
    calendars.map((a) => a.id),
    team.map((t) => t.email),
    from,
    to,
  ).data;
  const events = [
    ...(data?.events ?? []).filter(
      (e) => visibleKeys.has(calendarKey(e)) && (showDeclined || e.response !== "declined"),
    ),
    ...(team.length ? (teamData?.events ?? []) : []),
  ];
  const colors = new Map<string, string>([
    ...listed.map((c): [string, string] => [c.key, c.color]),
    ...team.map((t, i): [string, string] => [
      calendarKey({ accountId: `team:${t.email}`, calendarId: "busy" }),
      TEAM_COLORS[i % TEAM_COLORS.length]!,
    ]),
  ]);
  const colorOf = (key: string) => legible(colors.get(key) ?? "#8a8a8a");
  const defaultTarget = defaultCalendarOf(visible, chosenDefault);
  const defaultCalendar = defaultTarget
    ? { accountId: defaultTarget.account.id, calendarId: defaultTarget.info.id }
    : null;

  // From the drawer, an event the grid doesn't show (a hidden calendar's, a declined one) opens too.
  const cached = useCachedEvent(selection && !("draft" in selection) ? selection : null);
  const selected =
    selection && !("draft" in selection)
      ? (events.find(
          (e) =>
            e.accountId === selection.accountId &&
            e.calendarId === selection.calendarId &&
            e.id === selection.id,
        ) ?? cached)
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

  // Today and the mini month glide there: the grid scrolls to the day, or,
  // from far off, starts a step short of it and scrolls the last step.
  const target = useCalendar((s) => s.target);
  const glide = useLatest((to: Date) => {
    const reveal = useCalendar.getState().reveal;
    select(reveal);
    const step = stepGrid.current;
    if (mode === "month" || !step) {
      setDate(to);
      useCalendar.setState({ reveal: null });
      return;
    }
    const aligned = stepDays(mode === "week" ? startOfWeek(to) : startOfDay(to), 0, weekends);
    useCalendar.setState({ target: null, reveal: null });
    // Within the strip, glide there; from far off, start a step short of it.
    const at = strip.findIndex((d) => sameDay(d, aligned));
    if (at >= 0) {
      if (at !== buffer) step(at - buffer);
      return;
    }
    const lead = (aligned > days[0] ? 1 : -1) * days.length;
    setStart(stepDays(aligned, -lead, weekends));
    requestAnimationFrame(() => requestAnimationFrame(() => stepGrid.current?.(lead)));
  });
  useEffect(() => {
    // Glided already: a remount (Strict Mode's, or the panel opening Calendar) would drop the event it revealed.
    if (target && useCalendar.getState().target) glide.current(target);
  }, [target, glide]);
  const goToday = () => useCalendar.getState().goTo(new Date());

  const keys = useLatest({ go, selected, actions, select });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
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
      // No single letters: they'd catch the app's own (G then I).
      if (key === "arrowright") run(() => k.go(1));
      else if (key === "arrowleft") run(() => k.go(-1));
      else if ((key === "backspace" || key === "delete") && k.selected && !k.selected.readOnly) {
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

  const nameOf = (accountId: string) => {
    const account = calendars.find((a) => a.id === accountId);
    return account ? getAccountDisplayName(account) : accountId;
  };
  const failed = (data?.failed ?? []).flatMap((f) => {
    const found = listed.find((c) => c.key === calendarKey(f));
    return found && f.error !== "noAccess"
      ? [found.info.primary ? nameOf(f.accountId) : found.info.name]
      : [];
  });
  // Sign-ins from before the app read every calendar lack that permission: allowing it signs in
  // again, which upgrades the sign-in in place.
  const needsAccess = calendars.filter((account) =>
    [
      ...(lists ?? []).filter((l) => l.needsAccess).map((l) => l.accountId),
      ...(team.length ? (teamData?.schedules ?? []) : [])
        .filter((s) => s.error === "noAccess")
        .map((s) => s.accountId),
    ].includes(account.id),
  );
  const modeLabel = CALENDAR_MODES.find((m) => m.mode === mode)!.label;

  const agenda = useCalendar((s) => s.agenda);
  const agendaCalendar = listed.find((c) => c.key === agenda);

  const warnings = (
    <>
      {failed.length ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          Couldn&apos;t load {failed.join(", ")}
        </span>
      ) : null}
      {needsAccess.length ? <AllowCalendarAccess accounts={needsAccess} /> : null}
    </>
  );
  const agendaDrawer = agendaCalendar ? (
    // Beside the sidebar, as in Notion Calendar.
    <AgendaDrawer
      key={agendaCalendar.key}
      calendar={agendaCalendar}
      color={colorOf(agendaCalendar.key)}
      titleLeading={titleLeading}
    />
  ) : null;
  const panelOpen = Boolean(selected || (draft && selection && "draft" in selection));
  const panel = panelOpen ? (
    <EventPanel
      containerRef={bodyRef}
      event={selected}
      draft={selected ? null : draft}
      calendars={listed}
      colorOf={colorOf}
      actions={actions}
      margin={margin}
    />
  ) : null;
  const body = (
    <div
      ref={bodyRef}
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("[data-event]")) select(null);
      }}
    >
      <div
        key={mode === "month" ? `${mode}:${from}` : mode}
        className="flex min-h-0 flex-1 flex-col animate-calendar-in motion-reduce:animate-none"
      >
        {mode === "month" ? (
          <MonthGrid
            days={days}
            columns={weekends ? 7 : 5}
            month={date.getMonth()}
            events={events}
            colorOf={colorOf}
            defaultCalendar={defaultCalendar}
            onOpenDay={openDay}
          />
        ) : (
          <TimeGrid
            days={strip}
            visible={days.length}
            buffer={buffer}
            stepRef={stepGrid}
            onSettle={(shift) => setStart(strip[buffer + shift]!)}
            onPeek={(shift) => setPeek(shift ? strip[buffer + shift]! : null)}
            events={events}
            colorOf={colorOf}
            defaultCalendar={defaultCalendar}
            actions={actions}
            onOpenDay={openDay}
            margin={margin}
          />
        )}
      </div>
      {margin ? null : panel}
      {picking ? <TeamPicker onClose={() => setPicking(false)} /> : null}
    </div>
  );

  // Margin: the grid in a column under a large title, and a margin beside it that an event
  // opens in, wider and on a rule, instead of a popover.
  if (margin) {
    const dayStart = days[0].getTime();
    const onDay = events.filter(
      (e) => e.startMs < dayStart + DAY && e.endMs > dayStart && !e.teammate,
    ).length;
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        {agendaDrawer}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-calendar="">
          <div
            data-toolbar=""
            className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
          >
            {agendaCalendar ? null : titleLeading}
            {warnings}
            <span className="min-w-0 flex-1" />
            {titleTrailing}
          </div>
          <div className="flex min-h-0 flex-1 gap-10 px-6">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <MarginMasthead
                mode={mode}
                date={date}
                days={days}
                count={onDay}
                onMode={onMode}
                onToday={goToday}
                onStep={go}
              />
              {body}
            </div>
            <aside
              className={cn(
                "flex min-h-0 shrink-0 flex-col overflow-y-auto pb-agent-corner",
                panelOpen ? "w-96 border-l border-border pl-2" : "w-60 gap-6 pt-3",
              )}
            >
              {panel ?? (
                <CalendarMargin
                  mode={mode}
                  days={days}
                  events={events}
                  calendars={listed}
                  colorOf={colorOf}
                />
              )}
            </aside>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {agendaDrawer}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-calendar="">
        <div
          data-toolbar=""
          className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-3 px-4"
        >
          {agendaCalendar ? null : titleLeading}
          <CalendarTitle mode={mode} date={date} first={days[0]} />
          {warnings}
          <span className="min-w-0 flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" className="no-drag gap-1 px-2" />}
            >
              {modeLabel}
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              {CALENDAR_MODES.map((m) => (
                <DropdownMenuItem
                  key={m.mode}
                  icon={m.mode === mode ? <CheckIcon /> : <span className="size-4" />}
                  onClick={() => onMode(m.mode)}
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <HintTooltip label="Today">
            <Button size="sm" className="no-drag" onClick={goToday}>
              Today
            </Button>
          </HintTooltip>
          <div className="no-drag flex items-center">
            <HintTooltip label="Previous" hint="←">
              <IconButton label="Previous" onClick={() => go(-1)}>
                <ChevronLeftIcon />
              </IconButton>
            </HintTooltip>
            <HintTooltip label="Next" hint="→">
              <IconButton label="Next" onClick={() => go(1)}>
                <ChevronRightIcon />
              </IconButton>
            </HintTooltip>
          </div>
          {titleTrailing}
        </div>

        {body}
      </div>
    </div>
  );
}
