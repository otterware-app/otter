import { startChats } from "@otter/client/agents/chat-store";
import { setHost } from "@otter/client/host";
import { runsOn } from "@otter/contracts/extensions";
import { addDemoAgents, startCore, type CoreExtension, type CoreModule } from "@otter/core";
import { SQLiteStorage } from "expo-sqlite/kv-store";

import { installBridge } from "./bridge.ts";
import { phoneHost } from "./client-host.ts";
import { native } from "./native.ts";
import { phonePlatform } from "./platform.ts";

/** When the app's process started, core was ready and the app first listed the chats (ms since the epoch). */
export const startup = {
  launchedAt: Math.round(native.launchedAt()),
  coreReadyAt: 0,
  listShownAt: 0,
};

/**
 * Core in this runtime, the screens' bridge to it and @otter/client: before the app renders
 * anything that calls the client. `fake`: core's made-up services and scripted agents
 * (`@otter/core/fake`), kept apart from real data (its own files, database, storage and
 * Keychain service). `agents`: local gateways (`pnpm agents-server json`) to connect the account's
 * agents to, which are then real, beside the made-up rest.
 */
export async function startMobileCore(options: {
  secretsService: string;
  modules: readonly CoreModule[];
  extensions: readonly CoreExtension[];
  fake?: boolean;
  agents?: string;
  relayUrl?: string;
  existingDeviceId?: string;
  initialStorage?: Record<string, string>;
}): Promise<void> {
  const home = options.fake ? "fake" : "otter";
  const kv = new SQLiteStorage(`${home}-storage.db`);
  for (const [key, value] of Object.entries(options.initialStorage ?? {})) {
    if (kv.getItemSync(key) === null) kv.setItemSync(key, value);
  }
  const storage = {
    get: (key: string) => kv.getItemSync(key),
    set: (key: string, value: string) => kv.setItemSync(key, value),
  };
  let platform = phonePlatform({
    home,
    secretsService: options.fake ? `${options.secretsService}.fake` : options.secretsService,
    relayUrl: options.relayUrl,
  });
  let extensions = options.extensions.filter((e) => runsOn(e.manifest, "ios"));
  if (options.fake) {
    const { withFakeAgents, withFakeServices } = await import("@otter/core/fake");
    platform = await withFakeServices(platform);
    if (!options.agents) extensions = withFakeAgents(extensions);
  }
  installBridge({ appVersion: platform.appVersion, storage });
  setHost(phoneHost(storage));
  await startCore(platform, extensions, {
    modules: options.modules,
    existingDeviceId: options.existingDeviceId,
  });
  startChats();
  if (options.agents) {
    addDemoAgents(options.agents).catch((error: unknown) =>
      console.error("Couldn't connect the local agents", error),
    );
  }
  startup.coreReadyAt = Date.now();
}
