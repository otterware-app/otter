/// <reference types="node" />
import { MessageChannel } from "node:worker_threads";

import { CoreHostRpcs, CoreInvokeError, type HostMessage } from "@otter-mail/contracts/rpc";
import { layerServerProtocol, type RpcPort } from "@otter-mail/contracts/rpc-port";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { RpcServer } from "effect/rpc";

import { connectCore } from "./host.ts";

const wrap = (port: InstanceType<typeof MessageChannel>["port1"]): RpcPort => ({
  post: (message) => port.postMessage(message),
  listen(listener) {
    port.on("message", listener);
    return () => port.off("message", listener);
  },
});

/** A core that echoes, broadcasts once, and asks its host to seal a secret. */
const fakeCore = Effect.gen(function* () {
  const { port1, port2 } = new MessageChannel();
  const replies = yield* Queue.unbounded<{ id: number; result?: unknown; error?: string }>();
  const hang = yield* Deferred.make<void>();
  const handlers = CoreHostRpcs.toLayer({
    "core.ready": () => Effect.succeed({ channels: ["echo", "hang"] }),
    "core.invoke": ({ channel, params }) =>
      channel === "echo"
        ? Effect.succeed(params)
        : channel === "hang"
          ? Effect.as(Deferred.await(hang), null)
          : Effect.fail(new CoreInvokeError({ channel, message: `No handler for ${channel}.` })),
    "core.events": () => Stream.make({ channel: "gmail:mail-changed", params: { n: 1 } }),
    "core.host": () =>
      Stream.make<HostMessage[]>(
        { _tag: "request", id: 7, request: { _tag: "seal", text: "secret" } },
        { _tag: "effect", effect: { _tag: "badge", count: 4 } },
      ).pipe(Stream.concat(Stream.never)),
    "core.reply": (reply) => Effect.asVoid(Queue.offer(replies, reply)),
    "core.resume": () => Effect.void,
    "core.shutdown": () => Effect.void,
  });
  yield* Layer.launch(
    RpcServer.layer(CoreHostRpcs).pipe(
      Layer.provide(handlers),
      Layer.provide(layerServerProtocol(wrap(port1))),
    ),
  ).pipe(Effect.forkScoped);
  return { port: wrap(port2), replies };
});

describe("connectCore", () => {
  it.live("invokes, follows events and effects, and answers core's requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port, replies } = yield* fakeCore;
        const events: unknown[] = [];
        const effects: unknown[] = [];
        const core = connectCore(() => port, {
          onEvent: (channel, params) => events.push([channel, params]),
          onRequest: async (request) => (request._tag === "seal" ? `sealed:${request.text}` : null),
          onEffect: (effect) => effects.push(effect),
        });
        assert.deepStrictEqual(yield* Effect.promise(() => core.ready()), ["echo", "hang"]);
        const bytes = new Uint8Array([1, 2]);
        const echoed = yield* Effect.promise(() => core.invoke("echo", { bytes }));
        assert.deepStrictEqual(echoed, { bytes });
        const failure = yield* Effect.promise(() =>
          core.invoke("nope").then(
            () => null,
            (error: Error) => error.message,
          ),
        );
        assert.strictEqual(failure, "No handler for nope.");
        assert.deepStrictEqual(yield* Queue.take(replies), { id: 7, result: "sealed:secret" });
        assert.deepStrictEqual(events, [["gmail:mail-changed", { n: 1 }]]);
        assert.deepStrictEqual(effects, [{ _tag: "badge", count: 4 }]);
        core.stop("done");
      }),
    ),
  );

  it.live("fails calls in flight when core goes away", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { port } = yield* fakeCore;
        const core = connectCore(() => port, {
          onEvent: () => {},
          onRequest: async () => null,
          onEffect: () => {},
        });
        yield* Effect.promise(() => core.ready());
        const pending = core.invoke("hang").then(
          () => "answered",
          (error: Error) => error.message,
        );
        core.stop("The mail backend stopped.");
        assert.strictEqual(yield* Effect.promise(() => pending), "The mail backend stopped.");
      }),
    ),
  );
});
