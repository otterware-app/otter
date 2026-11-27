import { mailApi } from "@otter/client/mail/api";
import translation from "@otter/extension-translation/core";
import { demo } from "@otter/mobile/demo";
import { native } from "@otter/mobile/native";
import { watchLongTasks } from "@otter/mobile/long-tasks";
import { startMobileCore } from "@otter/mobile/start";

import { importSwiftMailState } from "./account/migration.ts";
import { errorReportsAvailable, followErrorReports, startErrorReports } from "./error-reports.ts";

export const fake = process.env.EXPO_PUBLIC_OTTER_DATA === "fake" || demo;
const benchmarkMode = fake ? process.env.EXPO_PUBLIC_OTTER_MAIL_BENCHMARK : undefined;
export const benchmark = benchmarkMode === "1" || benchmarkMode === "auto";
/** `pnpm bench:mobile:mail`: the list scrolls itself, the replay follows first sync, and the results go to a file. */
export const autoBenchmark = benchmarkMode === "auto";
export let benchmarkAccountId: string | undefined;

startErrorReports();

if (benchmark) watchLongTasks(native.currentThreadCpuMs);
const legacy = fake ? undefined : native.existingMailSettings();

export const coreStarted = startMobileCore({
  secretsService: "dev.otterware.mail",
  modules: ["mail"],
  extensions: [translation],
  fake,
  prepare: legacy ? (platform) => importSwiftMailState(platform, legacy) : undefined,
  initialStorage: legacy?.ui,
  relayUrl: __DEV__ ? process.env.EXPO_PUBLIC_OTTER_RELAY_URL : undefined,
  fakeGmailMessages: benchmark ? 50_000 : undefined,
  errorReports: errorReportsAvailable,
}).then(async () => {
  followErrorReports();
  if (!benchmark) return;
  // A fresh install would ask for notifications at the replay's first new mail, mid-measurement.
  await mailApi.setSyncSettings({ notificationsMode: "off" });
  benchmarkAccountId = (await import("@otter/core/fake")).largeGmailAccountId;
});
