/** An error as the user reads it: without the IPC wrapper Electron puts round a handler's. */
export function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}
