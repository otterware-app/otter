import type { CloudflareOptions } from "@sentry/cloudflare";

import { errorReportOptions, SENTRY_DSN } from "@otter-mail/shared/error-reports";

import type { Env } from "./worker.ts";

export function errorReports(env: Env): CloudflareOptions {
  const local = env.BETTER_AUTH_URL?.startsWith("http://localhost") ?? true;
  return errorReportOptions({
    dsn: local ? "" : SENTRY_DSN.relay,
    version: "relay",
    release: `otter-mail-relay@${env.CF_VERSION_METADATA?.id ?? "local"}`,
    environment: "production",
  }) as CloudflareOptions;
}
