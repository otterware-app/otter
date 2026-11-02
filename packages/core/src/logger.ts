import { platform } from "./platform.js";
import { recordSupportError } from "./services/support-errors.js";

function log(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  message: string,
  data?: unknown,
): void {
  recordSupportError(level, scope, message, data);
  platform().log(level, scope, message, data);
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => log("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => log("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => log("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => log("error", scope, message, data),
};
