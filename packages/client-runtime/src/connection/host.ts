import type { HostEffect, HostRequest } from "@otter-mail/contracts/rpc";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { makeCoreClient, type CoreClient, type RpcPort } from "../rpc/client.ts";

/** What the hosting app does for core: shows its broadcasts, answers its requests, carries out its effects. */
export interface CoreHostHandlers {
  onEvent(channel: string, params: unknown): void;
  onRequest(request: HostRequest): Promise<unknown>;
  onEffect(effect: HostEffect): void;
}

/** The app's connection to core, as promises: what Electron's main process and the web app's hosting tab use. */
export interface CoreHostConnection {
  /** Core started: the channels it answers. Rejects with core's start error. */
  ready(): Promise<readonly string[]>;
  /** Rejects with the handler's message, as `ipc` errors read today. */
  invoke(channel: string, params?: unknown): Promise<unknown>;
  resume(): void;
  shutdown(): void;
  /** Core went away: calls in flight fail with `reason`. */
  stop(reason: string): void;
  /** Opens a new port to a new core (after `stop`, or in place of the current one). */
  restart(): void;
}

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

type Session = {
  client: Promise<CoreClient>;
  ready: Promise<readonly string[]>;
  fiber: Fiber.Fiber<unknown, unknown>;
  calls: Set<(error: Error) => void>;
};

export function connectCore(open: () => RpcPort, handlers: CoreHostHandlers): CoreHostConnection {
  let session = start();

  function start(): Session {
    const port = open();
    let opened!: (client: CoreClient) => void;
    const client = new Promise<CoreClient>((resolve) => (opened = resolve));
    const answer = (core: CoreClient, id: number, request: HostRequest) =>
      handlers.onRequest(request).then(
        (result) => Effect.runFork(core.reply(id, { result })),
        (error: unknown) => Effect.runFork(core.reply(id, { error: messageOf(error) })),
      );
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const core = yield* makeCoreClient(port);
          opened(core);
          yield* Stream.runForEach(core.events, (event) =>
            Effect.sync(() => handlers.onEvent(event.channel, event.params)),
          ).pipe(Effect.forkScoped);
          yield* Stream.runForEach(core.host, (message) =>
            Effect.sync(() => {
              if (message._tag === "request") void answer(core, message.id, message.request);
              else handlers.onEffect(message.effect);
            }),
          ).pipe(Effect.forkScoped);
          return yield* Effect.never;
        }),
      ),
    );
    const calls = new Set<(error: Error) => void>();
    const ready = call<readonly string[]>(client, calls, (core) =>
      Effect.map(core.ready, ({ channels }) => channels),
    );
    ready.catch(() => {});
    return { client, ready, fiber, calls };
  }

  function call<A>(
    client: Promise<CoreClient>,
    calls: Set<(error: Error) => void>,
    run: (core: CoreClient) => Effect.Effect<A, unknown>,
  ): Promise<A> {
    return new Promise<A>((resolve, reject) => {
      const fail = (error: Error) => {
        calls.delete(fail);
        reject(error);
      };
      calls.add(fail);
      void client.then((core) =>
        Effect.runPromise(Effect.result(run(core))).then((result) => {
          if (!calls.has(fail)) return;
          calls.delete(fail);
          if (result._tag === "Success") resolve(result.success);
          else reject(new Error(messageOf(result.failure)));
        }, fail),
      );
    });
  }

  function stop(reason: string): void {
    const current = session;
    for (const fail of current.calls) fail(new Error(reason));
    Effect.runFork(Fiber.interrupt(current.fiber));
  }

  return {
    ready: () => session.ready,
    invoke: (channel, params) =>
      call(session.client, session.calls, (core) => core.invoke(channel, params)),
    resume() {
      void session.client.then((core) => Effect.runFork(Effect.ignore(core.resume)));
    },
    shutdown() {
      void session.client.then((core) => Effect.runFork(Effect.ignore(core.shutdown)));
    },
    stop,
    restart() {
      stop("Otter Mail's backend restarted.");
      session = start();
    },
  };
}
