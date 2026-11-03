import { useSyncExternalStore } from "react";
import { setSyncedPreference } from "../synced-preferences";

export type WeekStart = "auto" | "sunday" | "monday" | "saturday";
export type TimeFormat = "auto" | "12" | "24";

export type CalendarPreferences = {
  weekStart: WeekStart;
  showWeekends: boolean;
  showDeclined: boolean;
  timeFormat: TimeFormat;
  meetingsByDefault: string[];
  /** Where new events go (a calendarKey), picked in the sidebar; empty, the first primary one. */
  defaultCalendar: string;
  colors: Record<string, string>;
};

export const CALENDAR_DEFAULTS: CalendarPreferences = {
  weekStart: "auto",
  showWeekends: true,
  showDeclined: true,
  timeFormat: "auto",
  meetingsByDefault: [],
  defaultCalendar: "",
  colors: {},
};

const KEYS = {
  weekStart: "calendar:week-start",
  showWeekends: "calendar:show-weekends",
  showDeclined: "calendar:show-declined",
  timeFormat: "calendar:time-format",
  meetingsByDefault: "calendar:meetings-by-default",
  defaultCalendar: "calendar:default-calendar",
  colors: "calendar:colors",
} as const;

const WEEK_STARTS = new Set<string>(["auto", "sunday", "monday", "saturday"]);
const TIME_FORMATS = new Set<string>(["auto", "12", "24"]);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(readStorage(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function readRecord(key: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readStorage(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

function read(): CalendarPreferences {
  const weekStart = readStorage(KEYS.weekStart) as WeekStart;
  const timeFormat = readStorage(KEYS.timeFormat) as TimeFormat;
  return {
    weekStart: WEEK_STARTS.has(weekStart) ? weekStart : CALENDAR_DEFAULTS.weekStart,
    showWeekends: readStorage(KEYS.showWeekends) !== "false",
    showDeclined: readStorage(KEYS.showDeclined) !== "false",
    timeFormat: TIME_FORMATS.has(timeFormat) ? timeFormat : CALENDAR_DEFAULTS.timeFormat,
    meetingsByDefault: readList(KEYS.meetingsByDefault),
    defaultCalendar: readStorage(KEYS.defaultCalendar) ?? "",
    colors: readRecord(KEYS.colors),
  };
}

let current = read();
const listeners = new Set<() => void>();

function refresh(): void {
  const next = read();
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another device's (or another tab's) choice arrives as a storage event.
  if (listeners.size === 1) window.addEventListener("storage", refresh);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", refresh);
  };
}

export const calendarPreferences = (): CalendarPreferences => current;

export function useCalendarPreferences(): CalendarPreferences {
  return useSyncExternalStore(subscribe, calendarPreferences);
}

export function setCalendarPreference<K extends keyof CalendarPreferences>(
  key: K,
  value: CalendarPreferences[K],
): void {
  setSyncedPreference(KEYS[key], typeof value === "object" ? JSON.stringify(value) : String(value));
  refresh();
}
