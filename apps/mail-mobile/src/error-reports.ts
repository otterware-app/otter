import { ipc, listen } from "@otter/client/bridge";
import type { ErrorReportsConfig } from "@otter/core";
import {
  ConsentGate,
  errorReportOptions,
  reportEnvironment,
  SENTRY_DSN,
} from "@otter/shared/error-reports";
import { demo } from "@otter/mobile/demo";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

const version = Constants.expoConfig?.version ?? "0.0.0";
const build = Constants.expoConfig?.ios?.buildNumber ?? "0";

/** Release builds over real mail, and a development one started with `EXPO_PUBLIC_OTTER_ERROR_REPORTS=1`. */
export const errorReportsAvailable =
  Boolean(SENTRY_DSN.mail) &&
  !demo &&
  (__DEV__
    ? process.env.EXPO_PUBLIC_OTTER_ERROR_REPORTS === "1"
    : process.env.EXPO_PUBLIC_OTTER_DATA !== "fake");

// One @sentry/core in the bundle (metro.config.cjs): shared's events are the SDK's.
const gate = new ConsentGate((event) => Sentry.getClient()?.sendEvent(event as Sentry.Event));

/** Before core starts, so what fails while it does is reported. */
export function startErrorReports(): void {
  if (!errorReportsAvailable) return;
  Sentry.init({
    ...errorReportOptions({
      dsn: SENTRY_DSN.mail,
      version,
      // What scripts/sentry-release-ios.ts creates for each release.
      release: `otter-mail-ios@${version}+${build}`,
      environment: reportEnvironment(version, !__DEV__),
      allowed: gate.allowed,
    }),
    dist: build,
    integrations: [Sentry.expoRouterIntegration()],
    // They show mail, which Google's Limited Use rules keep people from reading.
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableUserInteractionTracing: true,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Its hang tracker reads frames that stop while the app is idle as a blocked main thread
    // (getsentry/sentry-cocoa#8317, OTTER-MAIL-IOS-5); iOS's own hang reports don't.
    enableAppHangTracking: false,
    enableMetricKit: true,
  } as Sentry.ReactNativeOptions);
}

/** Who events come from and whether they're sent, as core says once it runs. */
export function followErrorReports(): void {
  if (!errorReportsAvailable) return;
  const follow = (config: ErrorReportsConfig) => {
    Sentry.setUser(config.user);
    Sentry.setContext("install", { reportId: config.reportId });
    gate.set(config.enabled);
  };
  ipc<ErrorReportsConfig>("errorReports:config")
    .then(follow)
    .catch(() => {});
  listen("errorReports:changed", (config) => follow(config as ErrorReportsConfig));
}
