/**
 * How long the JavaScript thread was held, for development: a 10 ms interval that notes how late
 * each tick came. A tick late by n ms means something ran about n ms without yielding.
 */
const EVERY_MS = 10;
const ticks: { at: number; late: number; cpu?: number }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

export function watchLongTasks(threadCpuMs?: () => number): void {
  if (timer) return;
  let expected = Date.now() + EVERY_MS;
  let previousCpu = threadCpuMs?.();
  timer = setInterval(() => {
    const now = Date.now();
    const cpu = threadCpuMs?.();
    ticks.push({
      at: now,
      late: Math.max(0, now - expected),
      cpu:
        cpu !== undefined && previousCpu !== undefined ? Math.round(cpu - previousCpu) : undefined,
    });
    previousCpu = cpu;
    if (ticks.length > 100_000) ticks.splice(0, 50_000);
    expected = now + EVERY_MS;
  }, EVERY_MS);
}

/**
 * The longest block that overlapped `from`…`to` (ms since the epoch), and the 95th percentile of
 * the ticks' lateness. Timers fire on frames here, so a tick is about 7 ms late at rest.
 */
export function longTasks(from: number, to = Date.now()) {
  const samples = ticks.filter((t) => t.at >= from && t.at - t.late <= to);
  const worst = samples.reduce<(typeof ticks)[number] | undefined>(
    (previous, next) => (!previous || next.late > previous.late ? next : previous),
    undefined,
  );
  const late = samples.map((t) => t.late).sort((a, b) => a - b);
  return {
    longest: worst?.late ?? 0,
    longestAt: worst ? worst.at - from : null,
    cpuAtLongest: worst?.cpu,
    longestCpu: samples.reduce((max, sample) => Math.max(max, sample.cpu ?? 0), 0),
    p95: late[Math.floor(late.length * 0.95)] ?? 0,
  };
}

let slowSqlite: { at: number; ms: number; operation: string }[] = [];

export function measureSqlite<T>(kind: string, sql: string, run: () => T): T {
  if (!timer) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    const ms = Math.round(performance.now() - start);
    if (ms >= 16) {
      const operation = `${kind} ${sql.replace(/\s+/g, " ").trim().slice(0, 48)}`;
      slowSqlite.push({ at: Date.now(), ms, operation });
      if (slowSqlite.length > 1000) slowSqlite = slowSqlite.slice(-500);
    }
  }
}

export function longestSqlite(from: number) {
  return slowSqlite
    .filter(({ at }) => at >= from)
    .reduce<(typeof slowSqlite)[number] | undefined>(
      (longest, operation) => (!longest || operation.ms > longest.ms ? operation : longest),
      undefined,
    );
}
