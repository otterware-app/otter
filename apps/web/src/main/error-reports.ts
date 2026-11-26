import * as SentryElectron from "@sentry/electron/renderer";
import * as Sentry from "@sentry/react";
import type { Integration } from "@sentry/core";
import type { AnyRouter } from "@tanstack/react-router";

import type { ErrorReportsConfig } from "@otter/core";
import {
  ConsentGate,
  errorReportOptions,
  reportEnvironment,
  SENTRY_DSN,
} from "@otter/shared/error-reports";

const desktop = window.desktopBridge.platform !== "web";
const dsn = desktop ? SENTRY_DSN.desktop : SENTRY_DSN.web;

export const errorReportsAvailable = Boolean(dsn) && __ERROR_REPORTS__;

const gate = new ConsentGate();

export function startErrorReports(router: AnyRouter): void {
  if (!errorReportsAvailable) return;
  const options = {
    ...errorReportOptions({
      dsn,
      version: __APP_VERSION__,
      environment: reportEnvironment(__APP_VERSION__, import.meta.env.PROD),
      allowed: desktop ? undefined : gate.allowed,
    }),
    // Electron's `<webview>` when its element goes after its page did (browser/store.ts): harmless.
    ignoreErrors: [/Invalid guestInstanceId/],
    // The console repeats our own log lines.
    integrations: (defaults: Integration[]) => [
      ...defaults.filter(({ name }) => name !== "Console"),
      Sentry.tanstackRouterBrowserTracingIntegration(router),
    ],
  };
  if (desktop) SentryElectron.init(options, Sentry.init);
  else Sentry.init(options);

  const follow = (config: ErrorReportsConfig) => {
    Sentry.setUser(config.user);
    Sentry.setContext("install", { reportId: config.reportId });
    gate.set(config.enabled);
  };
  void window.desktopBridge
    .invoke<ErrorReportsConfig>("errorReports:config")
    .then(follow)
    .catch(() => {});
  window.desktopBridge.on("errorReports:changed", (config) => follow(config as ErrorReportsConfig));
}

export const reactErrorHandlers = {
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
};
