/** One JSON line per event, which Workers Logs indexes by field. Never a token or a secret. */
export function log(
  event: string,
  fields: Record<string, unknown> = {},
  level: "log" | "warn" | "error" = "log",
): void {
  console[level](JSON.stringify({ event, ...fields }));
}
