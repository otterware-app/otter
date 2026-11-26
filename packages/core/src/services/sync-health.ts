import type { ReportTags } from "@otter/shared/error-reports";

import { logger } from "../logger.ts";
import { findProvider, isSignedIn } from "../providers/index.ts";
import { imapHostOf, providerKindOf } from "./account-store.ts";
import { knownImapServer } from "./imap-discovery.ts";

type Lane = "mail" | "calendar";

/** Failing this long while awake is a mailbox the user can't fix: reported once a run. */
export const STALE_MS = 6 * 60 * 60_000;
/** Retries come every 10 minutes at most while awake: a longer gap is sleep or a quit, and doesn't count. */
const MAX_GAP_MS = 30 * 60_000;

const failing = new Map<string, { at: number; failingMs: number }>();
const reported = new Set<string>();

export function syncTags(accountId: string): ReportTags {
  const provider = providerKindOf(accountId);
  if (provider !== "imap") return { provider };
  return { provider, server: knownImapServer(imapHostOf(accountId)) };
}

export function syncSucceeded(lane: Lane, accountId: string): void {
  failing.delete(`${lane}:${accountId}`);
}

/** Offline, signed out or rate limited the user can see; every other failure adds up until a success. */
export function syncFailed(lane: Lane, accountId: string, err: unknown): void {
  const key = `${lane}:${accountId}`;
  const now = Date.now();
  const last = failing.get(key);
  const kind = findProvider(accountId)?.errorKind(err) ?? null;
  if (kind === "network" || kind === "auth" || !isSignedIn(accountId)) {
    if (last) last.at = now;
    return;
  }
  const gap = last ? now - last.at : 0;
  const failingMs = (last?.failingMs ?? 0) + (gap <= MAX_GAP_MS ? gap : 0);
  failing.set(key, { at: now, failingMs });
  if (failingMs < STALE_MS || reported.has(key)) return;
  reported.add(key);
  const message = `${lane === "mail" ? "Mail" : "Calendar"} hasn't synced in ${STALE_MS / 3_600_000} hours`;
  // The mailbox in the line keeps the log's deduplication from dropping a second mailbox's report.
  logger.error("sync-health", `${message}: ${accountId}`, {
    error: new Error(message, { cause: err }),
    tags: { ...syncTags(accountId), reason: kind ?? "error" },
  });
}

export function forgetSyncHealth(accountId: string): void {
  for (const lane of ["mail", "calendar"]) failing.delete(`${lane}:${accountId}`);
}
