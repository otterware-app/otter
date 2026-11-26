import hermes from "@otter/extension-hermes/core";
import openclaw from "@otter/extension-openclaw/core";
import varys from "@otter/extension-varys/core";
import { watchLongTasks } from "@otter/mobile/long-tasks";
import { native } from "@otter/mobile/native";
import { startMobileCore } from "@otter/mobile/start";

import { errorReportsAvailable, followErrorReports, startErrorReports } from "./error-reports.ts";

/** `pnpm dev:mobile:agents:fake`: core's made-up account, agents and chats, no network. */
export const FAKE = process.env.EXPO_PUBLIC_OTTER_DATA === "fake";

/** `pnpm agents-server json`: the account's agents connect to this Mac's gateways, and are real. */
const AGENTS = __DEV__ ? process.env.EXPO_PUBLIC_OTTER_AGENTS : undefined;

/** The self-test and the long-task watch: in development builds and builds over the fake, never in a release. */
export const DEV_TOOLS = __DEV__ || FAKE;

startErrorReports();

if (DEV_TOOLS) watchLongTasks();

const existing = FAKE ? undefined : native.existingAgentSettings();

/** Otter Agents has no mail: the Otter account, its agents and chats, preferences and realtime. */
export const coreStarted = startMobileCore({
  secretsService: "dev.otterware.agents",
  modules: [],
  extensions: [hermes, openclaw, varys],
  existingDeviceId: existing?.deviceId,
  existingAgentOutbox: existing?.deviceId ? (user) => native.existingAgentOutbox(user) : undefined,
  initialStorage: existing?.notifications === "off" ? { "otter:notifications": "off" } : undefined,
  fake: FAKE,
  agents: AGENTS,
  relayUrl: process.env.EXPO_PUBLIC_OTTER_RELAY_URL,
  errorReports: errorReportsAvailable,
});

void coreStarted.then(followErrorReports);
