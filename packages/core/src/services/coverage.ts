import { platform, type CoverageWindow } from "../platform.js";
import * as store from "./mail-store.js";

const DAY_MS = 86_400_000;

/** The most a sync run behind the app (`inBackground`) fetches; a bigger delta waits for the front. */
export const BACKGROUND_MAX_MESSAGES = 50;
export const BACKGROUND_MAX_PAGES = 5;

/** The window the cache keeps, or null when it keeps, or fills in, the whole mailbox. */
export function cacheWindow(): CoverageWindow | null {
  const { initialCoverage, automaticBackfill } = platform().syncPolicy;
  return initialCoverage === "mailbox" || automaticBackfill ? null : initialCoverage;
}

export const windowStart = (window: CoverageWindow): number => Date.now() - window.days * DAY_MS;

/** The app is behind and sync may only replay a bounded delta. */
export function inBackground(): boolean {
  const p = platform();
  return p.syncPolicy.execution === "foreground" && p.inForeground?.() === false;
}

/**
 * How far a mailbox's first fill reached, kept apart from the providers'
 * cursors (Gmail's historyId, IMAP's UIDs, Outlook's delta links): a window
 * filled is `done` without the mailbox ever counting as fully synced.
 * `cursor`: where a fill widened later picks up (Gmail's page token).
 */
export type Coverage = { since: number; done: boolean; cursor?: string };

const coverageKey = (accountId: string) => `syncCoverage:${accountId}`;

export function getCoverage(accountId: string): Coverage | null {
  try {
    return JSON.parse(store.getKv(coverageKey(accountId)) || "null") as Coverage | null;
  } catch {
    return null;
  }
}

export function setCoverage(accountId: string, coverage: Coverage): void {
  store.setKv(coverageKey(accountId), JSON.stringify(coverage));
}

/** A fill newest first has reached the window once its oldest mail is past it and the mailbox has its threads. */
export function windowReached(
  accountId: string,
  window: CoverageWindow,
  since: number,
  oldest: number,
): boolean {
  return oldest < since && store.countThreads(accountId) >= window.minThreads;
}
