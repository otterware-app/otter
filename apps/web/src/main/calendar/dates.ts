export type CalendarMode = "day" | "week" | "month";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The locale's first day of the week (0 Sunday … 6 Saturday). */
export const WEEK_START: number = (() => {
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
  return addDays(d, -((d.getDay() - WEEK_START + 7) % 7));
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

/** The days a mode shows around a date. */
export function visibleDays(mode: CalendarMode, date: Date, free = false): Date[] {
  if (mode === "day") return [startOfDay(date)];
  if (mode === "week") {
    const first = free ? startOfDay(date) : startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  }
  const first = startOfWeek(startOfMonth(date));
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const weeks = Math.ceil((last.getTime() - first.getTime() + DAY) / (7 * DAY));
  return Array.from({ length: Math.max(weeks, 5) * 7 }, (_, i) => addDays(first, i));
}

export function step(mode: CalendarMode, date: Date, by: number): Date {
  if (mode === "day") return addDays(date, by);
  if (mode === "week") return addDays(date, by * 7);
  return new Date(date.getFullYear(), date.getMonth() + by, 1);
}

export const weekdayShort = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short" });

export const monthTitle = (d: Date) =>
  d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

/** 9 AM, 9:30 AM (or 09:00 where the clock is 24-hour). */
export function timeLabel(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/:00(?=\s|$)/, "");
}

export function hourLabel(hour: number): string {
  const d = new Date(2000, 0, 1, hour);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}

export function durationLabel(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
