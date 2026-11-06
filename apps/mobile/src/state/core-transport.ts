import { createWorkletRuntime, scheduleOnRuntime } from "react-native-worklets";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { receive, startHost } from "../worker/host";
import type { FromWorker, ToWorker, WorkerConfig } from "../worker/protocol";

/**
 * The thin adapter between the UI and core's worker runtime: request/response
 * over worklets' scheduling, today's callHandler protocol. The Effect RPC
 * client (packages/client-runtime) takes its place behind CoreHost.
 */
export type CoreTransport = {
  invoke(channel: string, params?: unknown): Promise<unknown>;
  probe(name: string, args?: unknown): Promise<unknown>;
  resume(): void;
  subscribe(listener: (message: FromWorker) => void): () => void;
  ready: Promise<{ bootMs: number }>;
};

export function startWorkletsTransport(config: WorkerConfig): CoreTransport {
  const runtime = createWorkletRuntime({
    name: "otter-core",
    enableEventLoop: true,
    enableNetworking: true,
  });
  // Bundle Mode blocks TurboModules there: Nitro, and through it every
  // otter-* module, gets onto the worker this way.
  createWorkerHost().installNitro(runtime);

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const listeners = new Set<(message: FromWorker) => void>();
  let settleReady!: {
    resolve: (value: { bootMs: number }) => void;
    reject: (error: Error) => void;
  };
  const ready = new Promise<{ bootMs: number }>(
    (resolve, reject) => (settleReady = { resolve, reject }),
  );

  const deliver = (message: FromWorker) => {
    if (message.type === "result") {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) request?.reject(new Error(message.error));
      else request?.resolve(message.result);
    } else if (message.type === "ready") {
      settleReady.resolve({ bootMs: message.bootMs });
    } else if (message.type === "failed") {
      settleReady.reject(new Error(message.error));
    }
    for (const listener of listeners) listener(message);
  };

  const send = (message: ToWorker) =>
    scheduleOnRuntime(
      runtime,
      (m: ToWorker) => {
        "worklet";
        receive(m);
      },
      message,
    );

  scheduleOnRuntime(
    runtime,
    (target: (message: FromWorker) => void, workerConfig: WorkerConfig) => {
      "worklet";
      startHost(target, workerConfig);
    },
    deliver,
    config,
  );

  const request = (message: (id: number) => ToWorker) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send(message(id));
    });

  return {
    invoke: (channel, params) => request((id) => ({ type: "invoke", id, channel, params })),
    probe: (name, args) => request((id) => ({ type: "probe", id, name, args })),
    resume: () => send({ type: "resume" }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready,
  };
}
