import { SignInCancelledError } from "./google.js";
import { logger } from "./logger.js";
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

export async function callHandler(
  channel: string,
  params: unknown,
): Promise<{ result: unknown } | { error: string }> {
  try {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}.`);
    return { result: await handler(params) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!(err instanceof SignInCancelledError))
      logger.failure("handlers", `${channel} failed`, err);
    return { error: message };
  }
}
