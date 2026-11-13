import type { ReportTags } from "@otter/shared/error-reports";

import { SignInCancelledError, SignInTimedOutError } from "./google.js";
import { logger } from "./logger.js";
import { platform } from "./platform.js";
import { isSignInFailure } from "./providers/imap/sign-in-failure.js";
import { imapHostOf, isAccountId, providerKindOf } from "./services/account-store.js";
import { knownImapServer } from "./services/imap-discovery.js";

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
    if (err instanceof SignInTimedOutError || needsSignIn(err))
      logger.info("handlers", `${channel}: ${message}`);
    else if (!(err instanceof SignInCancelledError))
      logger.failure("handlers", `${channel} failed`, err, reportTags(params));
    return { error: message };
  }
}

/** A missing or refused IMAP password: the mailbox asks for it, and adding one says why. */
const needsSignIn = (err: unknown): boolean =>
  isSignInFailure(err) || (err instanceof Error && isSignInFailure(err.cause));

function reportTags(params: unknown): ReportTags | undefined {
  const accountId = (params as { accountId?: unknown } | null)?.accountId;
  if (typeof accountId !== "string" || !isAccountId(accountId)) return undefined;
  const provider = providerKindOf(accountId);
  if (provider !== "imap") return { provider };
  return { provider, server: knownImapServer(imapHostOf(accountId)) };
}
