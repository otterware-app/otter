import type { RpcPort } from "@otter-mail/contracts/rpc-port";
import { createWorkletRuntime, scheduleOnRuntime } from "react-native-worklets";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { startHost } from "../worker/host";
import { receive } from "../worker/port";
import type { WorkerConfig } from "../worker/protocol";
import { mark } from "./startup";

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
