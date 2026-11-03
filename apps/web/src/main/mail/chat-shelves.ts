import type { Chat } from "@otter-mail/contracts/chats";

export type ChatShelf = "active" | "snoozed" | "settled";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const SETTLE_AFTER_MS = 7 * DAY_MS;

/**
 * `working`: a turn runs in it here, so it doesn't settle for being idle.
 * `needsYou`: the agent asks for an approval or an answer, which outranks a
 * snooze or settling.
 */
export function chatShelf(
  chat: Pick<Chat, "updatedAt" | "snoozedUntil" | "settledAt">,
  { working, needsYou, now }: { working: boolean; needsYou: boolean; now: number },
): ChatShelf {
  if (needsYou) return "active";
  if (chat.snoozedUntil != null && chat.snoozedUntil > now) return "snoozed";
  if (chat.settledAt != null) return "settled";
  if (!working && now - chat.updatedAt > SETTLE_AFTER_MS) return "settled";
  return "active";
}

/** When it last came back to you: a snooze that ran out brings it back to the top. */
export function chatReturnedAt(chat: Pick<Chat, "updatedAt" | "snoozedUntil">, now: number) {
  const woke = chat.snoozedUntil != null && chat.snoozedUntil <= now ? chat.snoozedUntil : 0;
  return Math.max(chat.updatedAt, woke);
}

export type SnoozePreset = { id: string; label: string; when: string; until: number };

const timeOfDay = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function atHour(base: Date, days: number, hour: number): Date {
  const next = new Date(base);
  // Calendar days, not 24 hours, so a DST change can't skip a day.
  next.setDate(next.getDate() + days);
  next.setHours(hour, 0, 0, 0);
  return next;
}

export function snoozePresets(now: Date): SnoozePreset[] {
  const inHours = (hours: number) => new Date(now.getTime() + hours * HOUR_MS);
  const presets = [
    { id: "hour", label: "In 1 hour", date: inHours(1) },
    { id: "three-hours", label: "In 3 hours", date: inHours(3) },
  ];
  const evening = atHour(now, 0, 18);
  if (evening.getTime() - now.getTime() > HOUR_MS)
    presets.push({ id: "evening", label: "This evening", date: evening });
  const tomorrow = atHour(now, 1, 9);
  presets.push({ id: "tomorrow", label: "Tomorrow", date: tomorrow });
  const nextWeek = atHour(now, (1 - now.getDay() + 7) % 7 || 7, 9);
  if (nextWeek.getTime() !== tomorrow.getTime())
    presets.push({ id: "next-week", label: "Next week", date: nextWeek });
  return presets.map(({ id, label, date }) => ({
    id,
    label,
    when:
      id === "next-week"
        ? `${date.toLocaleDateString(undefined, { weekday: "short" })} ${timeOfDay(date)}`
        : timeOfDay(date),
    until: date.getTime(),
  }));
}

export function wakesIn(until: number, now: number): string {
  const left = until - now;
  if (left <= 0) return "now";
  if (left < HOUR_MS) return `${Math.max(1, Math.ceil(left / 60_000))}m`;
  if (left < DAY_MS) return `${Math.ceil(left / HOUR_MS)}h`;
  return `${Math.ceil(left / DAY_MS)}d`;
}

export function workingFor(since: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}
