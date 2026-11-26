import type { CloudflareOptions } from "@sentry/cloudflare";

import { errorReportOptions, SENTRY_DSN } from "@otter/shared/error-reports";

import type { Env } from "./worker.ts";

export function errorReports(env: Env): CloudflareOptions {
  return errorReportOptions({
    dsn: env.LOCAL === "true" ? "" : SENTRY_DSN.relay,
    version: "relay",
    release: `otter-mail-relay@${env.CF_VERSION_METADATA?.id ?? "local"}`,
    environment: "production",
  }) as CloudflareOptions;
}
