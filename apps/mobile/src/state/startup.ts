import { createWorkerHost } from "@otter-mail/mobile-worker";

/** Cold start, from the process's start: when core said it was ready, and when the inbox first showed mail. */
export const startup = {
  jsStartMs: 0,
  workerCreatedMs: 0,
  coreReadyMs: 0,
  firstContentMs: 0,
  rows: 0,
  residentMB: 0,
};

export function mark(name: "jsStartMs" | "workerCreatedMs"): void {
  startup[name] = Math.round(createWorkerHost().processUptime());
}

export function markCoreReady(): void {
  startup.coreReadyMs = Math.round(createWorkerHost().processUptime());
}

export function markFirstContent(rows: number): void {
  if (startup.firstContentMs > 0) return;
  const host = createWorkerHost();
  startup.firstContentMs = Math.round(host.processUptime());
  startup.rows = rows;
  startup.residentMB = Math.round(host.residentMemory() / 1048576);
  console.log(
    `[gate] cold start: JS ${startup.jsStartMs} ms, worker runtime ${startup.workerCreatedMs} ms, core ready ${startup.coreReadyMs} ms, first inbox rows ${startup.firstContentMs} ms (${rows} rows, ${startup.residentMB} MB)`,
  );
}
