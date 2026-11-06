import { serveCore, type CoreHost, type CoreHostOptions } from "@otter-mail/core";
import type {
  HostEffect,
  HostRequestKind,
  HostRequestParams,
  HostRequestResults,
} from "@otter-mail/contracts/rpc";

let link: CoreHost | null = null;

/** Serves core to main over the utility process's port; first thing the backend does. */
export function serveMain(options: CoreHostOptions): void {
  link = serveCore(
    {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process port has none
      post: (message) => process.parentPort.postMessage(message),
      listen(listener) {
        const onMessage = (event: Electron.MessageEvent) => listener(event.data);
        process.parentPort.on("message", onMessage);
        return () => process.parentPort.off("message", onMessage);
      },
    },
    options,
  );
}

const main = () => {
  if (!link) throw new Error("serveMain() has not run.");
  return link;
};

export function requestMain<K extends HostRequestKind>(
  kind: K,
  params: HostRequestParams<K>,
): Promise<HostRequestResults[K]> {
  return main().request(kind, params);
}

export function tellMain(effect: HostEffect): void {
  main().effect(effect);
}

export function broadcastToMain(channel: string, params?: unknown): void {
  main().broadcast(channel, params);
}
