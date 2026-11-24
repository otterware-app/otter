/**
 * How long the JavaScript thread was held, for development: a 10 ms interval that notes how late
 * each tick came. A tick late by n ms means something ran about n ms without yielding.
 */
const EVERY_MS = 10;
const ticks: { at: number; late: number }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

export function watchLongTasks(): void {
  if (timer) return;
  let expected = Date.now() + EVERY_MS;
  timer = setInterval(() => {
    const now = Date.now();
    ticks.push({ at: now, late: Math.max(0, now - expected) });
    if (ticks.length > 100_000) ticks.splice(0, 50_000);
    expected = now + EVERY_MS;
  }, EVERY_MS);
}

/**
 * The longest block that overlapped `from`…`to` (ms since the epoch), and the 95th percentile of
 * the ticks' lateness. Timers fire on frames here, so a tick is about 7 ms late at rest.
 */
export function longTasks(from: number, to = Date.now()): { longest: number; p95: number } {
  const late = ticks
    .filter((t) => t.at >= from && t.at - t.late <= to)
    .map((t) => t.late)
    .sort((a, b) => a - b);
  return {
    longest: late.at(-1) ?? 0,
    p95: late[Math.floor(late.length * 0.95)] ?? 0,
  };
}
