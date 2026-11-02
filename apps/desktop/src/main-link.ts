import type { FromBackend, MainEffect, MainRequests } from "./backend-protocol.js";

export function postToMain(message: FromBackend): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process port has none
  process.parentPort.postMessage(message);
}

let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

export function requestMain<K extends keyof MainRequests>(
  kind: K,
  params: MainRequests[K]["params"],
): Promise<MainRequests[K]["result"]> {
  const id = nextRequestId++;
  postToMain({ type: "request", id, kind, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
  });
}

export function settleRequest(id: number, result: unknown, error?: string): void {
  const request = pending.get(id);
  pending.delete(id);
  if (error !== undefined) request?.reject(new Error(error));
  else request?.resolve(result);
}

export function tellMain(effect: MainEffect): void {
  postToMain({ type: "effect", ...effect });
}
