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
