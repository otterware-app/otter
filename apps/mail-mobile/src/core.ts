import translation from "@otter/extension-translation/core";
import { watchLongTasks } from "@otter/mobile/long-tasks";
import { startMobileCore } from "@otter/mobile/start";

import { importSwiftMailboxes } from "./account/migration.ts";

export const fake = process.env.EXPO_PUBLIC_OTTER_DATA === "fake";
export const benchmark = fake && process.env.EXPO_PUBLIC_OTTER_MAIL_BENCHMARK === "1";
export let benchmarkAccountId: string | undefined;

if (benchmark) watchLongTasks();

export const coreStarted = startMobileCore({
  secretsService: "dev.otterware.mail",
  modules: ["mail"],
  extensions: [translation],
  fake,
  prepare: fake ? undefined : importSwiftMailboxes,
  relayUrl: __DEV__ ? process.env.EXPO_PUBLIC_OTTER_RELAY_URL : undefined,
  fakeGmailMessages: benchmark ? 50_000 : undefined,
}).then(async () => {
  if (benchmark) benchmarkAccountId = (await import("@otter/core/fake")).largeGmailAccountId;
});
