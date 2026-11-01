/**
 * The backend's channels: request handlers (renderer → backend, registered
 * with `handle`) and pushes (backend → renderer, `broadcast`). The shell
 * connects them to its transport: Electron IPC, or Worker messages.
 */

import { platform } from "./platform.js";

export type Handler = (params: unknown) => unknown;

const handlers = new Map<string, Handler>();

/** Registers the handler for `channel` (renderer: `desktopBridge.invoke(channel, params)`). */
export function handle(channel: string, handler: Handler): void {
  handlers.set(channel, handler);
}

/** Drops the handler for `channel` (an extension that failed to activate). */
export function unhandle(channel: string): void {
  handlers.delete(channel);
}

/** Every registered handler, for the shell to serve. */
export function registeredHandlers(): ReadonlyMap<string, Handler> {
  return handlers;
}

/** Pushes `params` on `channel` to every window (renderer: `desktopBridge.on`). */
export function broadcast(channel: string, params?: unknown): void {
  platform().broadcast(channel, params);
}
