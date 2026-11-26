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
  type ReportUser,
} from "@otter/shared/error-reports";

import { reportLogsTo } from "./logger.ts";

/** Local variables can hold sign-in tokens; the console repeats our log lines. */
const LEFT_OUT = new Set(["LocalVariables", "Console"]);

const gate = new ConsentGate();

let servedByBackend: (channel: string) => boolean = () => false;

/** Core reports its handlers' failures (callHandler): a window's uncaught copy of one is left out. */
export function reportedByBackend(serves: (channel: string) => boolean): void {
  servedByBackend = serves;
}

const backendFailure = (event: Sentry.ErrorEvent): boolean => {
  const value = event.exception?.values?.[0]?.value ?? "";
  const channel = /^Error invoking remote method '([^']+)'/.exec(value)?.[1];
  return channel !== undefined && servedByBackend(channel);
};

export const sendsErrorReports =
  Boolean(SENTRY_DSN.desktop) && (app.isPackaged || process.env.OTTER_ERROR_REPORTS === "1");

/** Before `ready`, and after the app's paths are set: Sentry keeps its queue in userData. */
export function startErrorReports(): void {
  if (!sendsErrorReports) return;
  const version = app.getVersion();
  Sentry.init({
    ...errorReportOptions({
      dsn: SENTRY_DSN.desktop,
      version,
      environment: reportEnvironment(version, app.isPackaged),
      allowed: (event) => !backendFailure(event) && gate.allowed(event),
    }),
    // Avoid injecting Sentry into browser tab sessions.
    ipcMode: Sentry.IPCMode.Classic,
    getSessions: () => [],
    // A screenshot shows mail; Google's Limited Use rules keep people from reading that.
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

export function followErrorReportsConfig(config: {
  enabled: boolean;
  reportId: string;
  user: ReportUser;
}): void {
  if (!sendsErrorReports) return;
  Sentry.setUser(config.user);
  Sentry.setContext("install", { reportId: config.reportId });
  gate.set(config.enabled);
}
