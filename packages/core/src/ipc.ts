import { platform } from "./platform.js";

export type Handler = (params: unknown) => unknown;

const handlers = new Map<string, Handler>();

export function handle(channel: string, handler: Handler): void {
  handlers.set(channel, handler);
}

export function unhandle(channel: string): void {
  handlers.delete(channel);
}

export function registeredHandlers(): ReadonlyMap<string, Handler> {
  return handlers;
}

export function broadcast(channel: string, params?: unknown): void {
  platform().broadcast(channel, params);
}
