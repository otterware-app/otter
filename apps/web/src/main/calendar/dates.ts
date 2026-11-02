import { calendarPreferences } from "./preferences";

export type CalendarMode = "day" | "week" | "month";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The locale's first day of the week (0 Sunday … 6 Saturday). */
const LOCALE_WEEK_START: number = (() => {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return first ? first % 7 : 0;
  } catch {
    return 0;
  }
})();

const WEEK_START_DAY = { sunday: 0, monday: 1, saturday: 6 } as const;

/** The week's first day: as set in Settings → Calendar, else the locale's. */
export function weekStart(): number {
  const chosen = calendarPreferences().weekStart;
  return chosen === "auto" ? LOCALE_WEEK_START : WEEK_START_DAY[chosen];
}

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  return addDays(d, -((d.getDay() - weekStart() + 7) % 7));
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in local time: the route's and all-day events' dates. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** `by` days on, counting only weekdays when weekends are hidden; from a weekend, the next weekday is 0. */
export function stepDays(date: Date, by: number, weekends = true): Date {
  if (weekends) return addDays(date, by);
  let d = startOfDay(date);
  while (isWeekend(d)) d = addDays(d, 1);
  for (let left = Math.abs(by); left > 0;) {
    d = addDays(d, Math.sign(by));
    if (!isWeekend(d)) left--;
  }
  return d;
}

/** The days a mode shows around a date; without weekends, the week's weekdays. */
export function visibleDays(mode: CalendarMode, date: Date, free = false, weekends = true): Date[] {
  if (mode === "day") return [startOfDay(date)];
  if (mode === "week") {
    const first = stepDays(free ? startOfDay(date) : startOfWeek(date), 0, weekends);
    return Array.from({ length: weekends ? 7 : 5 }, (_, i) => stepDays(first, i, weekends));
  }
  const first = startOfWeek(startOfMonth(date));
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const weeks = Math.ceil((last.getTime() - first.getTime() + DAY) / (7 * DAY));
  const days = Array.from({ length: Math.max(weeks, 5) * 7 }, (_, i) => addDays(first, i));
  return weekends ? days : days.filter((d) => !isWeekend(d));
}

export function step(mode: CalendarMode, date: Date, by: number): Date {
  if (mode === "day") return addDays(date, by);
  if (mode === "week") return addDays(date, by * 7);
  return new Date(date.getFullYear(), date.getMonth() + by, 1);
}

export const weekdayShort = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short" });

export const monthTitle = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

/** The clock as set in Settings → Calendar; otherwise the locale's. */
function hour12(): boolean {
  const chosen = calendarPreferences().timeFormat;
  if (chosen !== "auto") return chosen === "12";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 ?? false;
}

/** 9 AM, 9:30 AM, or 09:00 on a 24-hour clock. */
export function timeLabel(d: Date): string {
  if (!hour12())
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/:00(?=\s|$)/, "");
}

export function hourLabel(hour: number): string {
  const d = new Date(2000, 0, 1, hour);
  return hour12()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function durationLabel(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
