import { MessageChannel } from "node:worker_threads";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { RpcServer } from "effect/rpc";

import { CoreHostRpcs, CoreInvokeError } from "./rpc.js";
import { layerServerProtocol, makeClient, type RpcPort } from "./rpc-port.js";

function portPair(): [RpcPort, RpcPort] {
  const { port1, port2 } = new MessageChannel();
  const wrap = (port: typeof port1): RpcPort => ({
    post: (message) => port.postMessage(message),
    listen(listener) {
      const onMessage = (message: unknown) => listener(message);
      port.on("message", onMessage);
      return () => port.off("message", onMessage);
    },
  });
  return [wrap(port1), wrap(port2)];
}

const handlers = CoreHostRpcs.toLayer({
  "core.ready": () => Effect.succeed({ channels: ["echo"] }),
  "core.invoke": ({ channel, params }) =>
    channel === "echo"
      ? Effect.succeed(params)
      : Effect.fail(new CoreInvokeError({ channel, message: `No handler for ${channel}.` })),
  "core.events": () =>
    Stream.make(
      { channel: "a", params: 1 },
      { channel: "b", params: { bytes: new Uint8Array([7]) } },
    ),
  "core.host": () =>
    Stream.make({ _tag: "effect" as const, effect: { _tag: "badge" as const, count: 3 } }),
  "core.reply": () => Effect.void,
  "core.resume": () => Effect.void,
  "core.shutdown": () => Effect.void,
});

const client = Effect.gen(function* () {
  const [serverPort, clientPort] = portPair();
  yield* Layer.launch(
    RpcServer.layer(CoreHostRpcs).pipe(
      Layer.provide(handlers),
      Layer.provide(layerServerProtocol(serverPort)),
    ),
  ).pipe(
    Effect.tapCause((c) => Effect.sync(() => console.log("server died", String(c)))),
    Effect.forkScoped,
  );
  return yield* makeClient(CoreHostRpcs, clientPort);
});

describe("rpc-port", () => {
  it.effect("carries invokes, their failures and bytes over a copying port", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* client;
        assert.deepStrictEqual(yield* core["core.ready"](), { channels: ["echo"] });
        const params = { bytes: new Uint8Array([1, 2, 3]), at: new Date(0), missing: undefined };
        const echoed = (yield* core["core.invoke"]({ channel: "echo", params })) as typeof params;
        assert.instanceOf(echoed.bytes, Uint8Array);
        assert.deepStrictEqual([...echoed.bytes], [1, 2, 3]);
        assert.strictEqual(echoed.at.getTime(), 0);
        const failed = yield* Effect.exit(core["core.invoke"]({ channel: "nope", params: null }));
        assert.isTrue(Exit.isFailure(failed));
        const error = yield* Effect.flip(core["core.invoke"]({ channel: "nope", params: null }));
        assert.instanceOf(error, CoreInvokeError);
        assert.strictEqual(error.message, "No handler for nope.");
      }),
    ),
  );

  it.effect("streams events and host messages in order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const core = yield* client;
        const events = yield* Stream.runCollect(core["core.events"]());
        assert.deepStrictEqual(
          events.map((e) => e.channel),
          ["a", "b"],
        );
        assert.instanceOf((events[1].params as { bytes: Uint8Array }).bytes, Uint8Array);
        const host = yield* Stream.runCollect(core["core.host"]());
        assert.deepStrictEqual(host, [{ _tag: "effect", effect: { _tag: "badge", count: 3 } }]);
      }),
    ),
  );
});
