import * as SentryElectron from "@sentry/electron/renderer";
import * as Sentry from "@sentry/react";
import type { Integration } from "@sentry/core";

import type { ErrorReportsConfig } from "@otter-mail/core";
import {
  ConsentGate,
  errorReportOptions,
  reportEnvironment,
  SENTRY_DSN,
} from "@otter-mail/shared/error-reports";

const desktop = window.desktopBridge.platform !== "web";
const dsn = desktop ? SENTRY_DSN.desktop : SENTRY_DSN.web;

export const errorReportsAvailable = Boolean(dsn) && __ERROR_REPORTS__;

const gate = new ConsentGate();

export function startErrorReports(): void {
  if (!errorReportsAvailable) return;
  const options = {
    ...errorReportOptions({
      dsn,
      version: __APP_VERSION__,
      environment: reportEnvironment(__APP_VERSION__, import.meta.env.PROD),
      allowed: desktop ? undefined : gate.allowed,
    }),
    // What was clicked and the console can hold mail.
    integrations: (defaults: Integration[]) => [
      ...defaults.filter(({ name }) => name !== "Console" && name !== "Breadcrumbs"),
      Sentry.breadcrumbsIntegration({ dom: false }),
    ],
  };
  if (desktop) SentryElectron.init(options, Sentry.init);
  else Sentry.init(options);

  const follow = () =>
    void window.desktopBridge
      .invoke<ErrorReportsConfig>("errorReports:config")
      .then((config) => {
        Sentry.setUser({ id: config.reportId });
        gate.set(config.enabled);
      })
      .catch(() => {});
  follow();
  window.desktopBridge.on("settings:changed", follow);
}

export const reactErrorHandlers = {
  onCaughtError: Sentry.reactErrorHandler(),
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
};
