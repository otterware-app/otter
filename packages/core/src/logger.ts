import type { ReportTags } from "@otter-mail/shared/error-reports";
import { supportError } from "@otter-mail/shared/support";

import { GMAIL_ACCESS_MISSING_MESSAGE, SIGNED_OUT_MESSAGE } from "./google.js";
import { OUTLOOK_SIGNED_OUT_MESSAGE } from "./microsoft.js";
import { platform } from "./platform.js";
import { OTTER_SIGNED_OUT_MESSAGE } from "./services/otter-account.js";
import { recordSupportError } from "./services/support-errors.js";

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, scope: string, message: string, data?: unknown): void {
  recordSupportError(level, scope, message, data);
  platform().log(level, scope, message, data);
}

/** The network's doing, or a mailbox the user has to sign in to again: theirs to see, not ours to fix. */
function expected(message: string, error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
  if (
    reason === SIGNED_OUT_MESSAGE ||
    reason === GMAIL_ACCESS_MISSING_MESSAGE ||
    reason === OUTLOOK_SIGNED_OUT_MESSAGE ||
    reason === OTTER_SIGNED_OUT_MESSAGE
  )
    return true;
  const category = supportError("", "backend", `${message} ${reason}`)?.category;
  return category === "network" || category === "timeout" || category === "rate limit";
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => log("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => log("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => log("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => log("error", scope, message, data),
  failure: (scope: string, message: string, error: unknown, tags?: ReportTags) =>
    log(
      expected(message, error) ? "warn" : "error",
      scope,
      message,
      tags ? { error, tags } : error,
    ),
};
