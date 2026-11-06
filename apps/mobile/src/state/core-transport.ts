import type { RpcPort } from "@otter-mail/contracts/rpc-port";
import { DevSettings } from "react-native";
import { createWorkletRuntime, scheduleOnRuntime } from "react-native-worklets";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { startHost } from "../worker/host";
import { receive } from "../worker/port";
import type { WorkerConfig } from "../worker/protocol";
import { mark } from "./startup";

// Fast Refresh patches the UI runtime only; the worker evaluates the bundle the app
// downloaded at launch. An edit to what runs there (everything the UI reaches through
// this module: src/worker, core, its extensions) reloads the app instead, which starts
// the worker on the new bundle. Accepting here keeps the update from re-running core.ts,
// which would start a second worker on the old one.
declare const module: { hot?: { accept(callback: () => void): void } };
module.hot?.accept(() => DevSettings.reload("Core's worker code changed"));

/**
 * Starts core on its own runtime and returns the UI's end of the RpcPort to
 * it: the same protocol (`CoreHostRpcs`) the desktop's utility process and
 * the web's Worker speak, carried by worklets' scheduling.
 */
export function startCoreRuntime(config: WorkerConfig): RpcPort {
  mark("jsStartMs");
  const runtime = createWorkletRuntime({
    name: "otter-core",
    enableEventLoop: true,
    enableNetworking: true,
  });
  // Bundle Mode blocks TurboModules there: Nitro, and through it every
  // otter-* module, gets onto the worker this way.
  createWorkerHost().installNitro(runtime);
  mark("workerCreatedMs");

  const listeners = new Set<(message: unknown) => void>();
  const early: unknown[] = [];
  const deliver = (message: unknown) => {
    if (listeners.size === 0) early.push(message);
    for (const listener of listeners) listener(message);
  };

  scheduleOnRuntime(
    runtime,
    (target: (message: unknown) => void, workerConfig: WorkerConfig) => {
      "worklet";
      startHost(target, workerConfig);
    },
    deliver,
    config,
  );

  return {
    post(message) {
      scheduleOnRuntime(
        runtime,
        (frame: unknown) => {
          "worklet";
          receive(frame);
        },
        message,
      );
    },
    listen(listener) {
      listeners.add(listener);
      for (const message of early.splice(0)) listener(message);
      return () => listeners.delete(listener);
    },
  };
}
