import { formatDayLabel } from "@otter/client/mail/format";
import { native } from "@otter/mobile/native";

// A list draws the same dates over and over (each row recycled while scrolling, each refetch), and
// each formatting is a call to Foundation or to Intl: kept until the day changes.
let today = "";
const short = new Map<number, string>();
const days = new Map<number, string>();

function sameDay(): void {
  const now = new Date().toDateString();
  if (now === today && short.size < 10_000) return;
  today = now;
  short.clear();
  days.clear();
}

export function shortMailDate(timestamp: number): string {
  sameDay();
  let text = short.get(timestamp);
  if (text === undefined) short.set(timestamp, (text = native.shortMailDate(timestamp)));
  return text;
}

export function dayLabel(day: number): string {
  sameDay();
  let text = days.get(day);
  if (text === undefined) days.set(day, (text = formatDayLabel(day)));
  return text;
}

export const fullMailDate = (timestamp: number) => native.formatMailDate(timestamp);
