/** When a message was sent, as T3 Code shows it: the time today, else the day too. */
export function messageTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday at ${time}`;
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

const startOfDay = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** A message's time in its bubble: the day is in the pill above it. */
export const clockText = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The day pill between messages, and a chat's time in a phone's list, as WhatsApp says them:
 * Today (or, with `today: null`, the time), Yesterday, Friday, 3 Nov.
 */
export function dayText(at: number, now = Date.now(), today: string | null = "Today"): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return today ?? clockText(at);
  if (days === 1) return "Yesterday";
  const date = new Date(at);
  if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date(now).getFullYear() && { year: "numeric" }),
  });
}

/** The day pill above the turn at `index`: when it starts on another day than the turn before. */
export function turnDay(
  turns: { startedAt?: number; finishedAt?: number }[],
  index: number,
  now = Date.now(),
): string | null {
  const at = turns[index]?.startedAt ?? turns[index]?.finishedAt;
  if (at === undefined) return null;
  const before = turns.slice(0, index).findLast((t) => t.startedAt !== undefined)?.startedAt;
  if (before !== undefined && startOfDay(before) === startOfDay(at)) return null;
  return dayText(at, now);
}
