import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import {
  RpcClient,
  RpcServer,
  type Rpc,
  type RpcGroup,
  type RpcMessage,
  type RpcSerialization,
} from "effect/rpc";

/**
 * One end of a channel that copies what it carries (structured clone): a
 * Worker or its `self`, Electron's utility process or its `parentPort`, a
 * MessagePort, or the phone's worker runtime. One client talks to one server
 * on it.
 */
export interface RpcPort {
  post(message: unknown): void;
  listen(listener: (message: unknown) => void): () => void;
}

/**
 * The ports copy values, so protocol frames skip RpcSerialization; payloads
 * declared `Cloned` or `Bytes` (./rpc) pass through as they are. Streams
 * aren't acknowledged chunk by chunk: like a bare postMessage, they flow.
 */
const codecFor = Schema.toCodecJson as RpcSerialization.CodecFor;

const CLIENT_ID = 0;

function receive<A>(
  port: RpcPort,
  handle: (message: A) => Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const inbox = yield* Queue.unbounded<A>();
    const stop = port.listen((message) => Queue.offerUnsafe(inbox, message as A));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    yield* Queue.take(inbox).pipe(Effect.flatMap(handle), Effect.forever, Effect.forkScoped);
  });
}

/** The server end, where core runs. */
export const makeServerProtocol = (port: RpcPort) =>
  RpcServer.Protocol.make(
    Effect.fnUntraced(function* (writeRequest) {
      const disconnects = yield* Queue.unbounded<number>();
      yield* receive<RpcMessage.FromClientEncoded>(port, (message) =>
        writeRequest(CLIENT_ID, message),
      );
      return {
        disconnects,
        send: (_clientId, response) => Effect.sync(() => port.post(response)),
        end: () => Effect.void,
        clientIds: Effect.succeed(new Set([CLIENT_ID])),
        initialMessage: Effect.succeed(Option.none()),
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: false,
        supportsNotifications: false,
        codecFor,
      };
    }),
  );

export const layerServerProtocol = (port: RpcPort) =>
  Layer.effect(RpcServer.Protocol)(makeServerProtocol(port));

/** The client end, in the app hosting core. */
export const makeClientProtocol = (port: RpcPort) =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const clientOf = new Map<string | number, number>();
      yield* receive<RpcMessage.FromServerEncoded>(port, (message) => {
        const requestId = "requestId" in message ? message.requestId : undefined;
        const clientId = requestId === undefined ? undefined : clientOf.get(requestId);
        if (message._tag === "Exit" && requestId !== undefined) clientOf.delete(requestId);
        if (clientId !== undefined) return writeResponse(clientId, message);
        return Effect.forEach([...clientIds], (id) => writeResponse(id, message), {
          discard: true,
        });
      });
      return {
        send: (clientId, request) =>
          Effect.sync(() => {
            if (request._tag === "Request") clientOf.set(request.id, clientId);
            port.post(request);
          }),
        supportsAck: false,
        supportsTransferables: false,
        codecFor,
      };
    }),
  );

/**
 * A client of `group` on `port`, open for the caller's scope. (A client built
 * under `Effect.provide(layer)` would stop listening once it was made.)
 */
export const makeClient = <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>, port: RpcPort) =>
  RpcClient.make(group).pipe(
    Effect.provideServiceEffect(RpcClient.Protocol, makeClientProtocol(port)),
  );
