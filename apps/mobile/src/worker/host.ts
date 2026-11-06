import { createWorkerHost } from "@otter-mail/mobile-worker";

import { installPolyfills } from "./polyfills";
import { connectUi, workerPort } from "./port";
import type { WorkerConfig } from "./protocol";

/**
 * Core's host on the worker runtime, as apps/web's worker.ts is in the
 * browser: core serves its RPC protocol (`serveCore`) on the worklets port,
 * with the phone's Platform. `deliver` is the UI runtime's end of the port.
 */
export function startHost(deliver: (message: unknown) => void, config: WorkerConfig): void {
  connectUi(deliver);
  const host = createWorkerHost();
  installPolyfills(host);

  // After the polyfills: core's modules read globals as they load.
  const core = require("@otter-mail/core") as typeof import("@otter-mail/core");
  const { mobilePlatform } =
    require("../persistence/platform") as typeof import("../persistence/platform");
  const { registerProbes } = require("./probes") as typeof import("./probes");
  const { registerPushHandlers } = require("./push") as typeof import("./push");
  const { registerRecoveryHandlers } =
    require("./recovery-import") as typeof import("./recovery-import");

  const resumeListeners = new Set<() => void>();
  let ready: Promise<void> = new Promise(() => {});
  const served = core.serveCore(workerPort, {
    ready: () => ready,
    onResume: () => {
      for (const listener of resumeListeners) listener();
    },
  });

  ready = mobilePlatform({
    host,
    config,
    shell: {
      broadcast: (channel, params) => served.broadcast(channel, params),
      effect: (effect) => served.effect(effect),
      request: (kind, params) => served.request(kind, params),
      onResume(listener) {
        resumeListeners.add(listener);
        return () => resumeListeners.delete(listener);
      },
    },
  }).then(async (platform) => {
    const { mobileExtensions } = require("./extensions") as typeof import("./extensions");
    await core.startCore(platform, mobileExtensions);
    registerProbes();
    registerPushHandlers();
    registerRecoveryHandlers(host, config.demo);
  });
  ready.catch((error: unknown) =>
    host.log(
      "error",
      `Core failed to start: ${error instanceof Error ? error.stack : String(error)}`,
    ),
  );
}
