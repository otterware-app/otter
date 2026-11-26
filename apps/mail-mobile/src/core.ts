import translation from "@otter/extension-translation/core";
import { demo } from "@otter/mobile/demo";
import { native } from "@otter/mobile/native";
import { watchLongTasks } from "@otter/mobile/long-tasks";
import { startMobileCore } from "@otter/mobile/start";

import { importSwiftMailState } from "./account/migration.ts";
import { errorReportsAvailable, followErrorReports, startErrorReports } from "./error-reports.ts";

export const fake = process.env.EXPO_PUBLIC_OTTER_DATA === "fake" || demo;
export const benchmark = fake && process.env.EXPO_PUBLIC_OTTER_MAIL_BENCHMARK === "1";
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
  if (benchmark) benchmarkAccountId = (await import("@otter/core/fake")).largeGmailAccountId;
});
