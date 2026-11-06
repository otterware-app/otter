import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  platform,
  type ByteStream,
  type FileInfo,
  type NotificationReturn,
  type Platform,
  type SqlDatabase,
  type SyncPolicy as SyncPolicyShape,
} from "./platform.js";

/** A Platform call that rejected; `operation` names it ("files.read"). */
export class PlatformCallError extends Data.TaggedError("PlatformCallError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

const call = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new PlatformCallError({ operation, cause }) });

/** The Platform object itself, for what has no service of its own yet. */
export class CorePlatform extends Context.Service<CorePlatform, Platform>()(
  "@otter-mail/core/CorePlatform",
) {}

export class Database extends Context.Service<Database, SqlDatabase>()(
  "@otter-mail/core/Database",
) {}

export class Files extends Context.Service<
  Files,
  {
    readonly read: (path: string) => Effect.Effect<Uint8Array | null, PlatformCallError>;
    readonly write: (
      path: string,
      data: Uint8Array | string,
    ) => Effect.Effect<void, PlatformCallError>;
    readonly remove: (path: string) => Effect.Effect<void, PlatformCallError>;
    readonly list: (dir: string) => Effect.Effect<FileInfo[], PlatformCallError>;
  }
>()("@otter-mail/core/Files") {}

export class Secrets extends Context.Service<
  Secrets,
  {
    readonly get: (name: string) => Effect.Effect<string | null, PlatformCallError>;
    readonly set: (name: string, value: string) => Effect.Effect<void, PlatformCallError>;
    readonly delete: (name: string) => Effect.Effect<void, PlatformCallError>;
  }
>()("@otter-mail/core/Secrets") {}

/** How this device reaches mail servers and the web. */
export class Network extends Context.Service<
  Network,
  {
    readonly connect: (
      host: string,
      port: number,
      opts: { tls: boolean },
    ) => Effect.Effect<ByteStream, PlatformCallError>;
    readonly rawSockets: boolean;
    readonly crossOriginFetch: boolean;
    readonly relayUrl: string;
  }
>()("@otter-mail/core/Network") {}

export class SyncPolicy extends Context.Service<SyncPolicy, SyncPolicyShape>()(
  "@otter-mail/core/SyncPolicy",
) {}

export class Notifications extends Context.Service<
  Notifications,
  {
    readonly notify: (notification: Parameters<Platform["notify"]>[0]) => Effect.Effect<void>;
    readonly setUnreadCount: (count: number) => Effect.Effect<void>;
    readonly returnTo: NotificationReturn;
  }
>()("@otter-mail/core/Notifications") {}

/** Every service above, from a Platform object. */
export const layer = (p: Platform) =>
  Layer.mergeAll(
    Layer.succeed(CorePlatform, p),
    Layer.sync(Database, () => p.database()),
    Layer.succeed(Files, {
      read: (path) => call("files.read", () => p.files.read(path)),
      write: (path, data) => call("files.write", () => p.files.write(path, data)),
      remove: (path) => call("files.remove", () => p.files.remove(path)),
      list: (dir) => call("files.list", () => p.files.list(dir)),
    }),
    Layer.succeed(Secrets, {
      get: (name) => call("secrets.get", () => p.secrets.get(name)),
      set: (name, value) => call("secrets.set", () => p.secrets.set(name, value)),
      delete: (name) => call("secrets.delete", () => p.secrets.delete(name)),
    }),
    Layer.succeed(Network, {
      connect: (host, port, opts) => call("connect", () => p.connect(host, port, opts)),
      rawSockets: p.rawSockets,
      crossOriginFetch: p.crossOriginFetch,
      relayUrl: p.relayUrl,
    }),
    Layer.succeed(SyncPolicy, p.syncPolicy),
    Layer.succeed(Notifications, {
      notify: (notification) => Effect.sync(() => p.notify(notification)),
      setUnreadCount: (count) => Effect.sync(() => p.setUnreadCount(count)),
      returnTo: p.notificationReturn,
    }),
  );

/** The services of the Platform core started with (`startCore`). */
export const layerCurrent = Layer.unwrap(Effect.sync(() => layer(platform())));
