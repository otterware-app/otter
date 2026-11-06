import type { HostEffect } from "@otter-mail/contracts/rpc";
import { app } from "@otter-mail/mobile-app";
import {
  errorReportOptions,
  reportLog,
  SENTRY_DSN,
  type ReportTags,
  type SerializedError,
} from "@otter-mail/shared/error-reports";
import * as Sentry from "@sentry/react-native";
import { Settings } from "react-native";

/**
 * Scrubbed error reports to Sentry's otter-mail-ios, as on the Mac and the web
 * (docs/error-reports.md): the UI's errors, native crashes, iOS's MetricKit
 * diagnostics, and core's from the worker (its `report` effects). The choice
 * and the report ID are the Swift app's UserDefaults, so an upgrade keeps them.
 */

const ENABLED_KEY = "otter:errorReports";
const ID_KEY = "otter:reportID";

/** Release builds report; a Debug build only with `EXPO_PUBLIC_OTTER_MAIL_ERROR_REPORTS=1`. */
export const errorReportsAvailable =
  !__DEV__ || process.env.EXPO_PUBLIC_OTTER_MAIL_ERROR_REPORTS === "1";

export const errorReportsOn = (): boolean => Settings.get(ENABLED_KEY) !== false;

export function reportId(): string {
  const saved: unknown = Settings.get(ID_KEY);
  if (typeof saved === "string" && saved) return saved;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  Settings.set({ [ID_KEY]: id });
  return id;
}

let started = false;

/** Off, nothing starts: native crashes are sent at the next launch, which asks again. */
export function startErrorReports(): void {
  if (!errorReportsAvailable || started || !errorReportsOn()) return;
  started = true;
  Sentry.init({
    ...(errorReportOptions({
      dsn: SENTRY_DSN.ios,
      version: app.version,
      release: `otter-mail-ios@${app.version}+${app.build}`,
      environment: __DEV__ ? "development" : "production",
      allowed: errorReportsOn,
    }) as Sentry.ReactNativeOptions),
    dist: app.build,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    enableAutoSessionTracking: false,
    enableCaptureFailedRequests: false,
    enableNetworkBreadcrumbs: false,
    enableAutoBreadcrumbTracking: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Its hang tracker reads a main thread that isn't drawing (the app launched in the
    // background, for a refresh or a notification) as a fatal hang (OTTER-MAIL-IOS-5);
    // iOS's own hang reports, through MetricKit, don't.
    enableAppHangTracking: false,
    enableMetricKit: true,
    // What was touched and the console can hold mail.
    integrations: (defaults) => [
      ...defaults.filter(({ name }) => name !== "Breadcrumbs"),
      Sentry.breadcrumbsIntegration({ console: false, dom: false }),
    ],
  });
  Sentry.setUser({ id: reportId() });
}

export function setErrorReportsOn(on: boolean): void {
  Settings.set({ [ENABLED_KEY]: on });
  if (on) startErrorReports();
}

const sdk = {
  addBreadcrumb: Sentry.addBreadcrumb,
  captureException: Sentry.captureException,
  captureMessage: Sentry.captureMessage,
};

/** Core's `logger.error` and `logger.failure` on the worker, reported as the web app's are. */
export function reportFromCore(effect: Extract<HostEffect, { _tag: "report" }>): void {
  if (!started) return;
  const error = effect.error as SerializedError | undefined;
  const tags = effect.tags as ReportTags | undefined;
  reportLog(effect.level, effect.scope, effect.message, tags ? { error, tags } : error, sdk);
}
