import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ConsentGate,
  errorReportOptions,
  reportEnvironment,
  reportLog,
  SENTRY_DSN,
} from "@otter-mail/shared/error-reports";

import { reportLogsTo } from "./logger.js";

/** Native crash dumps hold memory, local variables hold values: either could be mail. */
const LEFT_OUT = new Set(["SentryMinidump", "LocalVariables", "Console", "Screenshots"]);

const gate = new ConsentGate();

export const sendsErrorReports =
  Boolean(SENTRY_DSN.desktop) && (app.isPackaged || process.env.OTTER_MAIL_ERROR_REPORTS === "1");

/** Before `ready`, and after the app's paths are set: Sentry keeps its queue in userData. */
export function startErrorReports(): void {
  if (!sendsErrorReports) return;
  const version = app.getVersion();
  Sentry.init({
    ...errorReportOptions({
      dsn: SENTRY_DSN.desktop,
      version,
      environment: reportEnvironment(version, app.isPackaged),
      allowed: gate.allowed,
    }),
    // Avoid injecting Sentry into browser tab sessions.
    ipcMode: Sentry.IPCMode.Classic,
    getSessions: () => [],
    attachScreenshot: false,
    integrations: (defaults) => defaults.filter((integration) => !LEFT_OUT.has(integration.name)),
  });
  gate.set(savedChoice());
  reportLogsTo(reportLog);
}

function savedChoice(): boolean {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    return (
      (JSON.parse(fs.readFileSync(file, "utf8")) as { errorReports?: unknown }).errorReports !==
      false
    );
  } catch {
    return true;
  }
}

export function setErrorReportsAllowed(enabled: boolean): void {
  gate.set(enabled);
}

export function setReportId(reportId: string): void {
  if (sendsErrorReports) Sentry.setUser({ id: reportId });
}
