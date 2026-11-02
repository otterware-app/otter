import { supportError } from "@otter-mail/shared/support";

import { platform } from "./platform.js";
import { recordSupportError } from "./services/support-errors.js";

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, scope: string, message: string, data?: unknown): void {
  recordSupportError(level, scope, message, data);
  platform().log(level, scope, message, data);
}

function transient(message: string, error: unknown): boolean {
  const text = `${message} ${error instanceof Error ? error.message : String(error)}`;
  const category = supportError("", "backend", text)?.category;
  return category === "network" || category === "timeout" || category === "rate limit";
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => log("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => log("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => log("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => log("error", scope, message, data),
  failure: (scope: string, message: string, error: unknown) =>
    log(transient(message, error) ? "warn" : "error", scope, message, error),
};
