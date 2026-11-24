import { watchLongTasks } from "@otter/mobile/long-tasks";
import { startMobileCore } from "@otter/mobile/start";

const fake = process.env.EXPO_PUBLIC_OTTER_DATA === "fake";
export const benchmark = fake && process.env.EXPO_PUBLIC_OTTER_MAIL_BENCHMARK === "1";
export let benchmarkAccountId: string | undefined;

if (benchmark) watchLongTasks();

export const coreStarted = startMobileCore({
  secretsService: "dev.otterware.mail",
  modules: ["mail"],
  extensions: [],
  fake,
  fakeGmailMessages: benchmark ? 50_000 : undefined,
}).then(async () => {
  if (benchmark) benchmarkAccountId = (await import("@otter/core/fake")).largeGmailAccountId;
});
