import hermes from "@otter/extension-hermes/core";
import openclaw from "@otter/extension-openclaw/core";
import varys from "@otter/extension-varys/core";
import { watchLongTasks } from "@otter/mobile/long-tasks";
import { startMobileCore } from "@otter/mobile/start";

/** `pnpm dev:mobile:agents:fake`: core's made-up account, agents and chats, no network. */
export const FAKE = process.env.EXPO_PUBLIC_OTTER_DATA === "fake";

/** The self-test and the long-task watch: in development builds and builds over the fake, never in a release. */
export const DEV_TOOLS = __DEV__ || FAKE;

if (DEV_TOOLS) watchLongTasks();

/** Otter Agents has no mail: the Otter account, its agents and chats, preferences and realtime. */
export const coreStarted = startMobileCore({
  secretsService: "dev.otterware.agents",
  modules: [],
  extensions: [hermes, openclaw, varys],
  fake: FAKE,
  relayUrl: process.env.EXPO_PUBLIC_OTTER_RELAY_URL,
});
