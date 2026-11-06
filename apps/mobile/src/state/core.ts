import Constants from "expo-constants";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AppState } from "react-native";

import { startWorkletsTransport, type CoreTransport } from "./core-transport";

export class CoreError extends Data.TaggedError("CoreError")<{
  readonly channel: string;
  readonly message: string;
}> {}

/**
 * Core, running on its own runtime: invoke its handlers, follow its
 * broadcasts. The UI only ever sees this service, so the worklets transport
 * underneath can give way to the Effect RPC client unchanged.
 */
export class CoreHost extends Context.Service<
  CoreHost,
  {
    readonly ready: Effect.Effect<{ readonly bootMs: number }, CoreError>;
    readonly invoke: <A = unknown>(
      channel: string,
      params?: unknown,
    ) => Effect.Effect<A, CoreError>;
    readonly probe: <A = unknown>(name: string, args?: unknown) => Effect.Effect<A, CoreError>;
    readonly events: (
      prefix: string,
    ) => Stream.Stream<{ readonly channel: string; readonly params: unknown }>;
  }
>()("@otter-mail/mobile/CoreHost") {}

const fromTransport = (transport: CoreTransport): CoreHost["Service"] => ({
  ready: Effect.tryPromise({
    try: () => transport.ready,
    catch: (error) => new CoreError({ channel: "ready", message: String(error) }),
  }),
  invoke: <A>(channel: string, params?: unknown) =>
    Effect.tryPromise({
      try: () => transport.invoke(channel, params) as Promise<A>,
      catch: (error) =>
        new CoreError({ channel, message: error instanceof Error ? error.message : String(error) }),
    }),
  probe: <A>(name: string, args?: unknown) =>
    Effect.tryPromise({
      try: () => transport.probe(name, args) as Promise<A>,
      catch: (error) =>
        new CoreError({
          channel: `probe:${name}`,
          message: error instanceof Error ? error.message : String(error),
        }),
    }),
  events: (prefix) =>
    Stream.callback<{ channel: string; params: unknown }>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          transport.subscribe((message) => {
            if (message.type === "event" && message.channel.startsWith(prefix)) {
              Queue.offerUnsafe(queue, { channel: message.channel, params: message.params });
            }
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    ),
});

export const layerWorklets = Layer.effect(
  CoreHost,
  Effect.sync(() => {
    const transport = startWorkletsTransport({
      appVersion: Constants.expoConfig?.version ?? "0.0.0",
      relayUrl: "https://relay.mail.otterware.app",
      // Phase 0 runs on the made-up mailbox (apps/web's fake Gmail), never a real account.
      demo: true,
    });
    AppState.addEventListener("change", (state) => {
      if (state === "active") transport.resume();
    });
    return fromTransport(transport);
  }),
);
