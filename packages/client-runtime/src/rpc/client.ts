import {
  CoreHostRpcs,
  type CoreEvent,
  type CoreInvokeError,
  type CoreStartError,
  type HostMessage,
} from "@otter-mail/contracts/rpc";
import { makeClient, type RpcPort } from "@otter-mail/contracts/rpc-port";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import type { RpcClientError } from "effect/rpc";

export type { RpcPort };

/** The RpcClient of core on one port, for Effect code (the phone's runtime). */
export interface CoreClient {
  readonly ready: Effect.Effect<
    { readonly channels: readonly string[] },
    CoreStartError | RpcClientError.RpcClientError
  >;
  readonly invoke: (
    channel: string,
    params?: unknown,
  ) => Effect.Effect<unknown, CoreInvokeError | RpcClientError.RpcClientError>;
  readonly events: Stream.Stream<CoreEvent, RpcClientError.RpcClientError>;
  readonly host: Stream.Stream<HostMessage, RpcClientError.RpcClientError>;
  readonly reply: (
    id: number,
    outcome: { result?: unknown; error?: string },
  ) => Effect.Effect<void, RpcClientError.RpcClientError>;
  readonly resume: Effect.Effect<void, RpcClientError.RpcClientError>;
  readonly shutdown: Effect.Effect<void, RpcClientError.RpcClientError>;
}

export const makeCoreClient = (port: RpcPort): Effect.Effect<CoreClient, never, Scope.Scope> =>
  Effect.map(makeClient(CoreHostRpcs, port), (client) => ({
    ready: client["core.ready"](),
    invoke: (channel, params) => client["core.invoke"]({ channel, params }),
    events: client["core.events"](),
    host: client["core.host"](),
    reply: (id, outcome) => client["core.reply"]({ id, ...outcome }),
    resume: client["core.resume"](),
    shutdown: client["core.shutdown"](undefined, { discard: true }),
  }));
