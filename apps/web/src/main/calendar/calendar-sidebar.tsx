import { useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EyeIcon,
  EyeOffIcon,
  RssIcon,
  SquareDotIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from "../mail/menu";
import { getAccountDisplayName } from "../mail/account-style";
import { Section, SidebarBody } from "../mail/sidebar-ui";
import type { MailAccount } from "../mail/types";
import { HintTooltip, cn } from "../mail/ui";
import { isShown, useCalendar } from "./calendar-store";
import { setCalendarPreference, useCalendarPreferences } from "./preferences";
import { useCalendarLists } from "./api";
import {
  TEAM_COLORS,
  calendarAccounts,
  defaultCalendarOf,
  listedCalendars,
  type ListedCalendar,
} from "./calendar-view";
import {
  addDays,
  sameDay,
  startOfMonth,
  startOfWeek,
  visibleDays,
  type CalendarMode,
} from "./dates";

const CALENDAR_COLORS: { name: string; hex: string }[] = [
  { name: "Red", hex: "#e5484d" },
  { name: "Coral", hex: "#d9776f" },
  { name: "Orange", hex: "#f2834d" },
  { name: "Yellow", hex: "#f0c24d" },
  { name: "Lime", hex: "#bddb6e" },
  { name: "Grass", hex: "#8fd165" },
  { name: "Green", hex: "#6cc78f" },
  { name: "Mint", hex: "#94dcc4" },
  { name: "Blue", hex: "#5ea8e0" },
  { name: "Sapphire", hex: "#4f80e8" },
  { name: "Indigo", hex: "#8e8cf0" },
  { name: "Violet", hex: "#b48ef0" },
  { name: "Purple", hex: "#9b5cf0" },
  { name: "Pink", hex: "#ec8fb5" },
  { name: "Blush", hex: "#d4a5ae" },
  { name: "Brown", hex: "#b07a62" },
  { name: "Gray", hex: "#a3a3a3" },
];

function MiniMonth({ mode }: { mode: CalendarMode }) {
  const date = useCalendar((s) => s.date);
  const free = useCalendar((s) => s.free);
  const peek = useCalendar((s) => s.peek);
  const goTo = useCalendar((s) => s.goTo);
  const [shown, setShown] = useState(() => startOfMonth(date));
  const [lastDate, setLastDate] = useState(date);
  if (lastDate !== date) {
    setLastDate(date);
    setShown(startOfMonth(date));
  }
  const weekends = useCalendarPreferences().showWeekends || mode === "day";
  const first = startOfWeek(shown);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const inView = peek
    ? visibleDays(mode, peek, true, weekends)
    : visibleDays(mode, date, free, weekends);
  const viewFrom = inView[0].getTime();
  const viewTo = inView[inView.length - 1].getTime();
  const today = new Date();
  const month = (by: number) => setShown(new Date(shown.getFullYear(), shown.getMonth() + by, 1));
  const awayFromToday =
    shown.getFullYear() !== today.getFullYear() || shown.getMonth() !== today.getMonth();
  return (
    <div className="px-(--sidebar-content-inset) pb-2">
      <div className="flex h-7 items-center pl-(--sidebar-row-content-inset) pr-0.5">
        <span className="flex-1 text-[13px] font-medium text-sidebar-foreground">
          {shown.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        {/* Off today's month, a way back to it (and the view to today). */}
        {awayFromToday ? (
          <MonthStep
            label="Back to today"
            onClick={() => {
              setShown(startOfMonth(today));
              goTo(today);
            }}
          >
            <Undo2Icon className="size-3.5" />
          </MonthStep>
        ) : null}
        <MonthStep label="Previous month" onClick={() => month(-1)}>
          <ChevronUpIcon className="size-3.5" />
        </MonthStep>
        <MonthStep label="Next month" onClick={() => month(1)}>
          <ChevronDownIcon className="size-3.5" />
        </MonthStep>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()} className="py-1 text-[10px] text-sidebar-muted-foreground">
            {d.toLocaleDateString(undefined, { weekday: "narrow" })}
          </span>
        ))}
        {days.map((d, i) => {
          const t = d.getTime();
          const inView = (day: Date | undefined) =>
            mode !== "month" && !!day && day.getTime() >= viewFrom && day.getTime() <= viewTo;
          const isToday = sameDay(d, today);
          const viewed = inView(d);
          const outside = d.getMonth() !== shown.getMonth();
          // The days in view are one band per row, rounded where it starts and ends.
          const col = i % 7;
          const opens = viewed && (col === 0 || !inView(days[i - 1]));
          const closes = viewed && (col === 6 || !inView(days[i + 1]));
          return (
            <div
              key={t}
              className={cn(
                "my-px flex h-[26px] items-center justify-center transition-colors duration-150",
                viewed && "bg-sidebar-row-selected",
                opens && "rounded-l-md",
                closes && "rounded-r-md",
              )}
            >
              <button
                type="button"
                onClick={() => goTo(d)}
                className={cn(
                  "flex size-[26px] cursor-pointer items-center justify-center rounded-md text-[11.5px] tabular-nums outline-none transition-colors duration-150",
                  isToday
                    ? "bg-(--calendar-today) font-medium text-white"
                    : viewed
                      ? "text-sidebar-foreground"
                      : outside
                        ? "text-sidebar-muted-foreground/50 hover:bg-sidebar-row-hover"
                        : "text-sidebar-foreground hover:bg-sidebar-row-hover",
                )}
              >
                {d.getDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function initials(name: string) {
  return (name.match(/\b\p{L}/gu) ?? [name[0] ?? "?"]).slice(0, 2).join("").toUpperCase();
}

function TeamCalendars() {
  const team = useCalendar((s) => s.team);
  const clearTeam = useCalendar((s) => s.clearTeam);
  if (!team.length) return null;
  return (
    <div className="mt-4">
      <div className="flex h-7 items-center px-(--sidebar-row-content-inset) text-xs font-medium text-sidebar-muted-foreground">
        Team calendars
      </div>
      <div className="relative rounded-lg bg-sidebar-row-selected py-0.5">
        {team.map((teammate, i) => (
          <div
            key={teammate.email}
            title={teammate.email}
            className="flex h-7 items-center gap-2 px-(--sidebar-row-content-inset) text-[13px] font-medium text-sidebar-foreground"
          >
            <span
              aria-hidden
              className="flex size-4 shrink-0 items-center justify-center rounded-full bg-sidebar-muted-foreground/45 text-[7px] font-semibold text-sidebar-foreground"
              style={{ boxShadow: `0 0 0 1.5px ${TEAM_COLORS[i % TEAM_COLORS.length]}` }}
            >
              {initials(teammate.name)}
            </span>
            <span className="min-w-0 flex-1 truncate">{teammate.name}</span>
          </div>
        ))}
        <HintTooltip label="Hide teammates" hint="Esc">
          <button
            type="button"
            aria-label="Hide teammates"
            onClick={clearTeam}
            className="absolute -right-1.5 -top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-sidebar-row-hover text-sidebar-muted-foreground shadow-[0_0_0_2px_var(--sidebar-surface)] outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <XIcon className="size-3" />
          </button>
        </HintTooltip>
      </div>
    </div>
  );
}

function MonthStep({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
    >
      {children}
    </button>
  );
}

export function CalendarSidebar({
  accounts,
  mode,
}: {
  accounts: MailAccount[];
  mode: CalendarMode;
}) {
  const shown = useCalendar((s) => s.shown);
  const setShown = useCalendar((s) => s.setShown);
  const agenda = useCalendar((s) => s.agenda);
  const setAgenda = useCalendar((s) => s.setAgenda);
  const mailboxes = calendarAccounts(accounts);
  const lists = useCalendarLists(mailboxes.map((a) => a.id)).data;
  const { defaultCalendar: chosen, colors } = useCalendarPreferences();
  const listed = listedCalendars(mailboxes, lists, colors);
  const showOnly = useCalendar((s) => s.showOnly);
  const defaultKey = defaultCalendarOf(
    listed.filter((c) => isShown(shown, c.key, c.info.hiddenByDefault)),
    chosen,
  )?.key;
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
      <MiniMonth mode={mode} />
      <SidebarBody>
        <TeamCalendars />
        {/* Each mailbox's calendars under its name, as Notion Calendar lists accounts. */}
        {mailboxes.map((account) => {
          const group = listed.filter((c) => c.account.id === account.id);
          if (!group.length) return null;
          return (
            <Section key={account.id} title={getAccountDisplayName(account)}>
              {group.map((calendar) => {
                const on = isShown(shown, calendar.key, calendar.info.hiddenByDefault);
                return (
                  <CalendarRow
                    key={calendar.key}
                    calendar={calendar}
                    on={on}
                    open={agenda === calendar.key}
                    isDefault={calendar.key === defaultKey}
                    onMakeDefault={() => {
                      setCalendarPreference("defaultCalendar", calendar.key);
                      if (!on) setShown(calendar.key, true);
                    }}
                    onOpen={() => setAgenda(agenda === calendar.key ? null : calendar.key)}
                    onToggle={() => setShown(calendar.key, !on)}
                    picked={colors[calendar.key] ?? null}
                    onColor={(hex) => {
                      const { [calendar.key]: _, ...rest } = colors;
                      setCalendarPreference(
                        "colors",
                        hex ? { ...rest, [calendar.key]: hex } : rest,
                      );
                    }}
                    onShowOnly={() =>
                      showOnly(
                        calendar.key,
                        listed.map((c) => c.key),
                      )
                    }
                  />
                );
              })}
            </Section>
          );
        })}
      </SidebarBody>
    </div>
  );
}

function CalendarRow({
  calendar,
  on,
  open,
  isDefault,
  onOpen,
  onMakeDefault,
  onToggle,
  picked,
  onColor,
  onShowOnly,
}: {
  calendar: ListedCalendar;
  on: boolean;
  open: boolean;
  isDefault: boolean;
  onOpen: () => void;
  onMakeDefault: () => void;
  onToggle: () => void;
  picked: string | null;
  onColor: (hex: string | null) => void;
  onShowOnly: () => void;
}) {
  const named = CALENDAR_COLORS.find((c) => c.hex === picked);
  const dot = (color: string) => (
    <span className="size-3.5 shrink-0 rounded-[4px]" style={{ background: color }} />
  );
  const swatch = (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] transition-[opacity,outline-color] duration-150",
        !on && "opacity-40",
      )}
      style={{
        background: calendar.color,
        outline: `1.5px solid ${isDefault ? calendar.color : "transparent"}`,
        outlineOffset: 1.5,
      }}
    >
      {calendar.info.writable ? null : <RssIcon className="size-2.5 text-white" strokeWidth={3} />}
    </span>
  );
  const { info } = calendar;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex h-7 w-full items-center rounded-md data-[state=open]:bg-sidebar-row-hover",
            open ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
          )}
        >
          {/* The square makes it the default, where it can take events. */}
          {info.writable ? (
            <HintTooltip label={isDefault ? "Default calendar" : "Make default"}>
              <button
                type="button"
                aria-label="Make default"
                aria-pressed={isDefault}
                onClick={onMakeDefault}
                className="ml-[calc(var(--sidebar-row-content-inset)-5px)] flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {swatch}
              </button>
            </HintTooltip>
          ) : (
            <span className="ml-[calc(var(--sidebar-row-content-inset)-5px)] flex size-6 shrink-0 items-center justify-center">
              {swatch}
            </span>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={onOpen}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center rounded-md pl-0.5 text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate transition-colors",
                on ? "text-sidebar-foreground" : "text-sidebar-muted-foreground/70",
              )}
            >
              {info.name}
              {isDefault ? (
                <span className="ml-1.5 font-normal text-sidebar-muted-foreground">Default</span>
              ) : null}
            </span>
          </button>
          <HintTooltip label={on ? "Hide calendar" : "Show calendar"}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={on ? "Hide calendar" : "Show calendar"}
              onClick={onToggle}
              className={cn(
                "mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-[color,opacity] hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus-ring",
                on && "opacity-0 group-hover:opacity-100",
              )}
            >
              {on ? <EyeIcon className="size-3.5" /> : <EyeOffIcon className="size-3.5" />}
            </button>
          </HintTooltip>
        </div>
      </ContextMenuTrigger>
      {/* Notion Calendar's menu, for what Otter Mail does. */}
      <ContextMenuContent className="min-w-56">
        <ContextMenuSub label="Color" icon={dot(calendar.color)} detail={named?.name}>
          {CALENDAR_COLORS.map((c) => (
            <ContextMenuItem key={c.hex} icon={dot(c.hex)} onSelect={() => onColor(c.hex)}>
              <span className="flex items-center justify-between gap-4">
                {c.name}
                {c.hex === picked ? <CheckIcon className="size-3.5 text-foreground" /> : null}
              </span>
            </ContextMenuItem>
          ))}
          {picked ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<Undo2Icon />} onSelect={() => onColor(null)}>
                Its own color
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<SquareDotIcon />}
          disabled={!info.writable || isDefault}
          onSelect={onMakeDefault}
        >
          Make default calendar
        </ContextMenuItem>
        <ContextMenuItem icon={<EyeIcon />} onSelect={onShowOnly}>
          Show only this calendar
        </ContextMenuItem>
        <ContextMenuItem icon={on ? <EyeOffIcon /> : <EyeIcon />} onSelect={onToggle}>
          {on ? "Hide calendar" : "Show calendar"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
