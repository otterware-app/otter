import type { RpcPort } from "@otter-mail/contracts/rpc-port";
import { scheduleOnRN } from "react-native-worklets";

/**
 * The worker's end of core's RpcPort: frames from the UI arrive through
 * `receive` (a worklet the UI schedules here), frames to it go back with
 * scheduleOnRN. Worklets' serializer copies them, as postMessage would.
 */

const listeners = new Set<(message: unknown) => void>();
let toUi: ((message: unknown) => void) | null = null;
const early: unknown[] = [];
/** Frames that came before core's server listened (it starts in a fiber of its own). */
const inbox: unknown[] = [];

export function connectUi(deliver: (message: unknown) => void): void {
  toUi = deliver;
  for (const message of early.splice(0)) scheduleOnRN(deliver, message);
}

export function receive(message: unknown): void {
  if (listeners.size === 0) inbox.push(message);
  for (const listener of listeners) listener(message);
}

export const workerPort: RpcPort = {
  post(message) {
    if (toUi) scheduleOnRN(toUi, message);
    else early.push(message);
  },
  listen(listener) {
    listeners.add(listener);
    for (const message of inbox.splice(0)) listener(message);
    return () => listeners.delete(listener);
  },
};
