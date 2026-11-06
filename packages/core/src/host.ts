import {
  CoreHostRpcs,
  CoreInvokeError,
  CoreStartError,
  type CoreEvent,
  type HostEffect,
  type HostMessage,
  type HostRequest,
  type HostRequestKind,
  type HostRequestParams,
  type HostRequestResults,
} from "@otter-mail/contracts/rpc";
import { layerServerProtocol, type RpcPort } from "@otter-mail/contracts/rpc-port";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { RpcServer } from "effect/rpc";

import { callHandler, registeredHandlers } from "./ipc.js";

export type { RpcPort };

export interface CoreHostOptions {
  /** Core has started (or failed to): invokes wait for it. */
  ready(): Promise<void>;
  onResume(): void;
  onShutdown?(): void;
}

/** Core's side of the connection to the app hosting it. */
export interface CoreHost {
  broadcast(channel: string, params?: unknown): void;
  request<K extends HostRequestKind>(
    kind: K,
    params: HostRequestParams<K>,
  ): Promise<HostRequestResults[K]>;
  effect(effect: HostEffect): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Serves core's handlers over `port` (core.invoke), with its broadcasts and
 * its requests and effects for the host as streams held until the host
 * subscribes. The host is the RpcClient of `CoreHostRpcs`.
 */
export function serveCore(port: RpcPort, options: CoreHostOptions): CoreHost {
  const events = Effect.runSync(Queue.unbounded<CoreEvent>());
  const outbox = Effect.runSync(Queue.unbounded<HostMessage>());
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextRequestId = 1;

  const started = Effect.tryPromise({
    try: () => options.ready(),
    catch: (error) => new CoreStartError({ message: messageOf(error) }),
  });

  const handlers = CoreHostRpcs.toLayer({
    "core.ready": () =>
      started.pipe(Effect.map(() => ({ channels: [...registeredHandlers().keys()] }))),
    "core.invoke": ({ channel, params }) =>
      started.pipe(
        Effect.mapError((error) => new CoreInvokeError({ channel, message: error.message })),
        Effect.flatMap(() => Effect.promise(() => callHandler(channel, params))),
        Effect.flatMap((outcome) =>
          "error" in outcome
            ? Effect.fail(new CoreInvokeError({ channel, message: outcome.error }))
            : Effect.succeed(outcome.result),
        ),
      ),
    "core.events": () => Stream.fromQueue(events),
    "core.host": () => Stream.fromQueue(outbox),
    "core.reply": ({ id, result, error }) =>
      Effect.sync(() => {
        const request = pending.get(id);
        pending.delete(id);
        if (error !== undefined) request?.reject(new Error(error));
        else request?.resolve(result);
      }),
    "core.resume": () => Effect.sync(() => options.onResume()),
    "core.shutdown": () => Effect.sync(() => options.onShutdown?.()),
  });

  Effect.runFork(
    Layer.launch(
      RpcServer.layer(CoreHostRpcs).pipe(
        Layer.provide(handlers),
        Layer.provide(layerServerProtocol(port)),
      ),
    ),
  );

  return {
    broadcast(channel, params) {
      Queue.offerUnsafe(events, { channel, params });
    },
    request(kind, params) {
      const id = nextRequestId++;
      const request = { _tag: kind, ...params } as HostRequest;
      Queue.offerUnsafe(outbox, { _tag: "request", id, request });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      });
    },
    effect(effect) {
      Queue.offerUnsafe(outbox, { _tag: "effect", effect });
    },
  };
}
