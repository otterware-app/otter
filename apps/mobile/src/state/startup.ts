import { createWorkerHost } from "@otter-mail/mobile-worker";

/** When the inbox first showed mail, from the process's start: cold start, both runtimes included. */
export const startup = { firstContentMs: 0, rows: 0, residentMB: 0 };

export function markFirstContent(rows: number): void {
  if (startup.firstContentMs > 0) return;
  const host = createWorkerHost();
  startup.firstContentMs = Math.round(host.processUptime());
  startup.rows = rows;
  startup.residentMB = Math.round(host.residentMemory() / 1048576);
  console.log(
    `[gate] cold start to first inbox rows: ${startup.firstContentMs} ms (${rows} rows, ${startup.residentMB} MB)`,
  );
}
