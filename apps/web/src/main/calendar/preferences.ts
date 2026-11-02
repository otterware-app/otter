import { useSyncExternalStore } from "react";
import { setSyncedPreference } from "../synced-preferences";

/** Settings → Calendar, kept with the Otter account so every device has them. */
export type WeekStart = "auto" | "sunday" | "monday" | "saturday";
export type TimeFormat = "auto" | "12" | "24";

export type CalendarPreferences = {
  weekStart: WeekStart;
  showWeekends: boolean;
  showDeclined: boolean;
  timeFormat: TimeFormat;
};

export const CALENDAR_DEFAULTS: CalendarPreferences = {
  weekStart: "auto",
  showWeekends: true,
  showDeclined: true,
  timeFormat: "auto",
};

const KEYS = {
  weekStart: "calendar:week-start",
  showWeekends: "calendar:show-weekends",
  showDeclined: "calendar:show-declined",
  timeFormat: "calendar:time-format",
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

function read(): CalendarPreferences {
  const weekStart = readStorage(KEYS.weekStart) as WeekStart;
  const timeFormat = readStorage(KEYS.timeFormat) as TimeFormat;
  return {
    weekStart: WEEK_STARTS.has(weekStart) ? weekStart : CALENDAR_DEFAULTS.weekStart,
    showWeekends: readStorage(KEYS.showWeekends) !== "false",
    showDeclined: readStorage(KEYS.showDeclined) !== "false",
    timeFormat: TIME_FORMATS.has(timeFormat) ? timeFormat : CALENDAR_DEFAULTS.timeFormat,
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

/** For the date helpers, outside React: what the calendar shows now. */
export const calendarPreferences = (): CalendarPreferences => current;

export function useCalendarPreferences(): CalendarPreferences {
  return useSyncExternalStore(subscribe, calendarPreferences);
}

export function setCalendarPreference<K extends keyof CalendarPreferences>(
  key: K,
  value: CalendarPreferences[K],
): void {
  setSyncedPreference(KEYS[key], String(value));
  refresh();
}
