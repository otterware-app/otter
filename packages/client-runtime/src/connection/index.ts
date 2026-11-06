import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

import { makeCoreClient, type CoreClient, type RpcPort } from "../rpc/client.ts";

export { connectCore, type CoreHostConnection, type CoreHostHandlers } from "./host.ts";

/** The connection to core, for Effect code: invoke, the event stream, the host's stream. */
export class CoreConnection extends Context.Service<CoreConnection, CoreClient>()(
  "@otter-mail/client-runtime/connection/CoreConnection",
) {}

export const layer = (port: RpcPort) => Layer.effect(CoreConnection)(makeCoreClient(port));

/**
 * What the state modules need of core, wherever it runs: an invoke and core's
 * broadcasts. In a window it's `window.desktopBridge`; on the phone, a
 * `CoreHostConnection` or `CoreConnection`.
 */
export interface CoreBridge {
  invoke<T = unknown>(channel: string, params?: unknown): Promise<T>;
  on(channel: string, listener: (params: unknown) => void): () => void;
}
