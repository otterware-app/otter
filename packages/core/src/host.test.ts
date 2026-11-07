import { CoreHostRpcs } from "@otter-mail/contracts/rpc";
import { makeClient, type RpcPort } from "@otter-mail/contracts/rpc-port";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

vi.mock("./logger.js", () => ({ logger: { info: () => {}, failure: () => {} } }));

import { serveCore } from "./host.js";
import { handle } from "./ipc.js";

/** Two ends that copy what they carry, as a Worker's do. */
function portPair(): [RpcPort, RpcPort] {
  const ends = [new Set<(m: unknown) => void>(), new Set<(m: unknown) => void>()];
  const end = (mine: number): RpcPort => ({
    post(message) {
      const copy = structuredClone(message);
      queueMicrotask(() => ends[1 - mine].forEach((listener) => listener(copy)));
    },
    listen(listener) {
      ends[mine].add(listener);
      return () => ends[mine].delete(listener);
    },
  });
  return [end(0), end(1)];
}

describe("serveCore", () => {
  it.live("answers invokes once core has started, with handlers' failures as errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        handle("test:echo", (params) => params);
        handle("test:fail", () => {
          throw new Error("Gmail said no");
        });
        let start!: () => void;
        const started = new Promise<void>((resolve) => (start = resolve));
        const [corePort, hostPort] = portPair();
        serveCore(corePort, { ready: () => started, onResume: () => {} });
        const client = yield* makeClient(CoreHostRpcs, hostPort);

        const echoed = yield* client["core.invoke"]({ channel: "test:echo", params: 1 }).pipe(
          Effect.forkScoped,
        );
        start();
        assert.strictEqual(yield* Fiber.join(echoed), 1);
        const failure = yield* Effect.flip(
          client["core.invoke"]({ channel: "test:fail", params: null }),
        );
        assert.deepStrictEqual(
          { tag: failure._tag, message: failure.message },
          { tag: "CoreInvokeError", message: "Gmail said no" },
        );
        const { channels } = yield* client["core.ready"]();
        assert.isTrue(channels.includes("test:echo"));
      }),
    ),
  );

  it.live("holds broadcasts until the host subscribes, and settles its requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [corePort, hostPort] = portPair();
        const host = serveCore(corePort, { ready: async () => {}, onResume: () => {} });
        host.broadcast("gmail:mail-changed", { accountId: "a" });
        const sealed = host.request("seal", { text: "secret" });
        const client = yield* makeClient(CoreHostRpcs, hostPort);

        const [event] = yield* Stream.runCollect(Stream.take(client["core.events"](), 1));
        assert.deepStrictEqual(event, {
          channel: "gmail:mail-changed",
          params: { accountId: "a" },
        });
        const [message] = yield* Stream.runCollect(Stream.take(client["core.host"](), 1));
        assert.deepStrictEqual(message, {
          _tag: "request",
          id: 1,
          request: { _tag: "seal", text: "secret" },
        });
        yield* client["core.reply"]({ id: 1, result: "c2VhbGVk" });
        assert.strictEqual(yield* Effect.promise(() => sealed), "c2VhbGVk");
      }),
    ),
  );

  it.live("fails invokes with the start error when core couldn't start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [corePort, hostPort] = portPair();
        serveCore(corePort, {
          ready: () => Promise.reject(new Error("The database is locked.")),
          onResume: () => {},
        });
        const client = yield* makeClient(CoreHostRpcs, hostPort);
        const startError = yield* Effect.flip(client["core.ready"]());
        assert.strictEqual(startError.message, "The database is locked.");
        const invokeError = yield* Effect.flip(
          client["core.invoke"]({ channel: "test:echo", params: 1 }),
        );
        assert.strictEqual(invokeError.message, "The database is locked.");
      }),
    ),
  );
});
