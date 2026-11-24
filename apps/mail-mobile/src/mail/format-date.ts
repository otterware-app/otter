import { dayKey } from "@otter/client/mail/format";
import { native } from "@otter/mobile/native";
import { getCalendars, getLocales } from "expo-localization";

const locale = getLocales()[0].languageTag;
const uses24HourClock = getCalendars()[0].uses24hourClock;
const time: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  hour12: uses24HourClock == null ? undefined : !uses24HourClock,
};
const today = new Intl.DateTimeFormat(locale, time);
const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
const monthAndDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
const older = new Intl.DateTimeFormat(locale, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

export function shortMailDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  if (dayKey(timestamp) === dayKey(now.getTime())) return today.format(date);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
  if (date >= weekStart && date < now) return weekday.format(date);
  return (date.getFullYear() === now.getFullYear() ? monthAndDay : older).format(date);
}

export const fullMailDate = (timestamp: number) => native.formatMailDate(timestamp);
