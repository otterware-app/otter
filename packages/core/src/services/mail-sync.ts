// Keep backfill and body downloads in separate lanes so they cannot delay new-mail sync.

import { logger } from "../logger.js";
import { broadcast } from "../ipc.js";
import { mapPool } from "../pool.js";
import { findProvider, isSignedIn, providerFor, signedOutMessage } from "../providers/index.js";
import { SyncCancelled, type MailProvider } from "../providers/provider.js";
import { getAttachmentData, hasCachedAttachment } from "./attachment-cache.js";
import { isAccountId, listAccounts } from "./account-store.js";
import { platform } from "../platform.js";
import * as store from "./mail-store.js";
import { notifyNewMail, updateDockBadge } from "./notifier.js";
import type { MessageDetail, SyncStatus } from "../types.js";

const statuses = new Map<string, SyncStatus>();
const running = new Set<string>();
const backfilling = new Set<string>();

function ensureStatus(accountId: string): SyncStatus {
  const existing = statuses.get(accountId);
  if (existing) return existing;
  const state = store.getSyncState(accountId);
  const status: SyncStatus = {
    accountId,
    syncing: false,
    phase: "idle",
    synced: 0,
    total: null,
    lastSyncAt: state.lastSyncAt,
    fullSyncDone: state.fullSyncDone,
    error: null,
    signInNeeded: false,
    download: null,
    revision: 0,
  };
  statuses.set(accountId, status);
  return status;
}

function update(accountId: string, patch: Partial<SyncStatus>): void {
  Object.assign(ensureStatus(accountId), patch);
}

function bumpRevision(accountId: string): void {
  const status = ensureStatus(accountId);
  status.revision += 1;
}

/** A message the server no longer has leaves the cache, and lists refresh. */
export function forgetMessage(accountId: string, messageId: string): void {
  if (store.deleteMessage(accountId, messageId)) bumpRevision(accountId);
}

export function getSyncStatus(accountId: string): SyncStatus {
  const status = ensureStatus(accountId);
  return { ...status, download: status.download ? { ...status.download } : null };
}

const lastFinishedAt = new Map<string, number>();
// Read-path triggers (list handlers refetching) must not restart a sync right
// after one finished: completion invalidates the renderer's queries, whose
// refetch hits those handlers again — without a cooldown that loops forever.
const READ_TRIGGER_COOLDOWN_MS = 20_000;

// A failing account (offline, revoked sign-in, Gmail rate limits) is retried
// on a growing delay instead of on every timer tick and list refetch. Asking
// explicitly (Sync button, menu, switching to the account) always runs.

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
type Failures = Map<string, { count: number; retryAt: number }>;
const failures: Failures = new Map();
const backfillFailures: Failures = new Map();
/** A sync was requested while one ran: run once more when it ends (explicitly, or as a push, which respects backoff). */
const rerun = new Map<string, "explicit" | "push">();

function recordFailure(accountId: string, map = failures): void {
  const count = (map.get(accountId)?.count ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS);
  map.set(accountId, { count, retryAt: Date.now() + delay });
}

const PUSHED_POLL_MS = 5 * 60_000;
let pushedAccounts: ReadonlySet<string> = new Set();

export function setPushedAccounts(accountIds: Iterable<string>): void {
  pushedAccounts = new Set(accountIds);
}

const watches = new Map<string, () => void>();
const watched = new Set<string>();

function startWatch(accountId: string): void {
  const watch = findProvider(accountId)?.watch;
  if (!watch || watches.has(accountId)) return;
  watches.set(
    accountId,
    watch(accountId, () => {
      watched.add(accountId);
      syncAccount(accountId, { force: true, trigger: "push" });
    }),
  );
}

function stopWatch(accountId: string): void {
  watches.get(accountId)?.();
  watches.delete(accountId);
  watched.delete(accountId);
}

const isPushed = (accountId: string) => pushedAccounts.has(accountId) || watched.has(accountId);

/**
 * Kick off a background sync for one account (no-op if one is already running).
 * `force` skips the post-sync cooldown (launch, timer, push, user); non-forced
 * calls are read-path triggers. `trigger: "timer" | "push"` still respects
 * failure backoff, which only an explicit request (`force` without a trigger)
 * skips. A push or explicit request arriving mid-run runs once more after it.
 */
/**
 * Mailboxes turned off in Settings → Connections (the renderer's synced UI
 * preference `mail:mailboxes`, which names them by address, as account ids
 * do): left unsynced, so they cost no mail traffic and raise no
 * notifications. Turning one back on syncs it at once.
 */
let turnedOff = new Set<string>();

export const turnedOffMailboxes = (): ReadonlySet<string> => turnedOff;

export function followMailboxArrangement(value: string | undefined): void {
  let off: string[] = [];
  try {
    const parsed = (JSON.parse(value ?? "{}") as { off?: unknown }).off;
    if (Array.isArray(parsed)) off = parsed.filter((e): e is string => typeof e === "string");
  } catch {
    // Unreadable: treat every mailbox as on.
  }
  const was = turnedOff;
  turnedOff = new Set(off);
  for (const id of turnedOff) stopWatch(id);
  for (const id of was) if (!turnedOff.has(id) && isAccountId(id)) syncAccount(id, { force: true });
  // An alias mailbox turned on or off changes what its parent's tab may leave out (`restScope`).
  const toggled = [...was, ...turnedOff].filter((id) => was.has(id) !== turnedOff.has(id));
  if (toggled.some((id) => !isAccountId(id))) broadcast("gmail:mail-changed");
  updateDockBadge();
}

export function syncAccount(
  accountId: string,
  opts?: { force?: boolean; trigger?: "timer" | "push" },
): void {
  const explicit = opts?.force === true && opts.trigger === undefined;
  if (running.has(accountId)) {
    if (explicit) rerun.set(accountId, "explicit");
    else if (opts?.trigger === "push" && !rerun.has(accountId)) rerun.set(accountId, "push");
    return;
  }
  removed.delete(accountId);
  if (turnedOff.has(accountId)) return;
  if (!isSignedIn(accountId)) {
    stopWatch(accountId);
    update(accountId, { syncing: false, error: signedOutMessage(accountId), signInNeeded: true });
    return;
  }
  startWatch(accountId);
  if (!explicit && Date.now() < (failures.get(accountId)?.retryAt ?? 0)) return;
  if (
    opts?.trigger === "timer" &&
    isPushed(accountId) &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < PUSHED_POLL_MS
  ) {
    return;
  }
  if (
    !opts?.force &&
    Date.now() - (lastFinishedAt.get(accountId) ?? 0) < READ_TRIGGER_COOLDOWN_MS
  ) {
    return;
  }
  running.add(accountId);
  broadcast("gmail:sync-started");
  void runSync(accountId).finally(() => {
    running.delete(accountId);
    lastFinishedAt.set(accountId, Date.now());
    const again = rerun.get(accountId);
    rerun.delete(accountId);
    if (again && !removed.has(accountId)) {
      syncAccount(accountId, again === "push" ? { force: true, trigger: "push" } : { force: true });
    }
  });
}

export async function syncAllAccounts(opts?: {
  force?: boolean;
  trigger?: "timer" | "push";
}): Promise<void> {
  try {
    const accounts = await listAccounts();
    for (const account of accounts) syncAccount(account.id, opts);
  } catch (err) {
    logger.error("mail-sync", `syncAllAccounts failed: ${String(err)}`, err);
  }
}

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

export function configureAutoSync(intervalSeconds: number): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (intervalSeconds > 0) {
    autoSyncTimer = setInterval(
      () => void syncAllAccounts({ force: true, trigger: "timer" }),
      intervalSeconds * 1000,
    );
  }
  logger.info(
    "mail-sync",
    `auto-sync ${intervalSeconds > 0 ? `every ${intervalSeconds}s` : "disabled"}`,
  );
}

// A sync already in flight for a removed account must not write its mail
// back into the cache: every write point checks `assertActive`, which aborts
// the run with a SyncCancelled.

const removed = new Set<string>();

function assertActive(accountId: string): void {
  if (removed.has(accountId)) throw new SyncCancelled(accountId);
}

export function forgetAccount(accountId: string): void {
  removed.add(accountId);
  stopWatch(accountId);
  statuses.delete(accountId);
  lastFinishedAt.delete(accountId);
  failures.delete(accountId);
  backfillFailures.delete(accountId);
  rerun.delete(accountId);
}

function describeSyncError(accountId: string, err: unknown): string {
  const provider = findProvider(accountId);
  if (provider) return provider.describeError(err);
  const text = String(err);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function syncFailureLevel(provider: MailProvider, err: unknown): "warn" | "error" {
  return provider.errorKind(err) ? "warn" : "error";
}

function needsSignIn(accountId: string, provider: MailProvider, err: unknown): boolean {
  return !isSignedIn(accountId) || provider.errorKind(err) === "auth";
}

function runSync(accountId: string): Promise<void> {
  const provider = providerFor(accountId);
  return provider.background("sync", () => runSyncNow(accountId, provider));
}

function laneStatus(
  accountId: string,
  syncRunning = running.has(accountId),
): Pick<SyncStatus, "syncing" | "phase"> {
  if (backfilling.has(accountId)) return { syncing: true, phase: "full" };
  return syncRunning
    ? { syncing: true, phase: ensureStatus(accountId).phase }
    : { syncing: false, phase: "idle" };
}

async function runSyncNow(accountId: string, provider: MailProvider): Promise<void> {
  const { lastSyncAt } = store.getSyncState(accountId);
  const startedAt = Date.now();
  const shown = (patch: Partial<SyncStatus>) => {
    if (!backfilling.has(accountId)) return patch;
    const { phase: _phase, synced: _synced, total: _total, ...rest } = patch;
    return rest;
  };
  update(accountId, shown({ syncing: true, error: null, synced: 0, total: null }));

  let synced = false;
  try {
    await provider.sync(accountId, {
      update: (patch) => update(accountId, shown(patch)),
      bumpRevision: () => bumpRevision(accountId),
      assertActive: () => assertActive(accountId),
      newMail: (messages) => notifyNewMail(accountId, messages, lastSyncAt),
    });

    assertActive(accountId);
    store.setSyncState(accountId, { lastSyncAt: startedAt });
    failures.delete(accountId);
    synced = true;
    update(accountId, {
      ...laneStatus(accountId, false),
      signInNeeded: false,
      lastSyncAt: startedAt,
      fullSyncDone: store.getSyncState(accountId).fullSyncDone,
    });
  } catch (err) {
    if (err instanceof SyncCancelled) {
      logger.info("mail-sync", err.message);
      return;
    }
    recordFailure(accountId);
    logger[syncFailureLevel(provider, err)](
      "mail-sync",
      `${provider.kind} sync failed for ${accountId}: ${describeSyncError(accountId, err)}`,
      err,
    );
    update(accountId, {
      ...laneStatus(accountId, false),
      error: describeSyncError(accountId, err),
      signInNeeded: needsSignIn(accountId, provider, err),
    });
    if (!isSignedIn(accountId)) stopWatch(accountId);
  }

  updateDockBadge();
  keepWithinCache();
  if (!isSignedIn(accountId)) return;
  if (provider.needsBackfill?.(accountId)) {
    if (synced) startBackfill(accountId, provider);
  } else {
    startDownloads(accountId, provider);
  }
}

const EVICT_EVERY_MS = 10 * 60_000;
let evictedAt = 0;

/** A device that keeps only so much (syncPolicy.cacheBytes) lets the least recently opened mail go. */
function keepWithinCache(): void {
  const budget = platform().syncPolicy.cacheBytes;
  if (budget === undefined || Date.now() - evictedAt < EVICT_EVERY_MS) return;
  evictedAt = Date.now();
  try {
    const { bodiesDropped, rowsDropped } = store.evictToFit(budget);
    if (bodiesDropped + rowsDropped > 0) {
      logger.info("mail-sync", "evicted to fit the cache", { bodiesDropped, rowsDropped });
    }
  } catch (err) {
    logger.error("mail-sync", "eviction failed", err);
  }
}

// The provider's long work (Gmail: the first sync of the whole mailbox, the
// refresh after its history feed expired), in its own lane and quota tier:
// the sync lane keeps running beside it, so new mail still comes in. Stopped
// work (quit, rate limits, sleep) picks up where it was after the next sync.

function startBackfill(accountId: string, provider: MailProvider): void {
  if (backfilling.has(accountId) || removed.has(accountId) || !provider.backfill) return;
  if (Date.now() < (backfillFailures.get(accountId)?.retryAt ?? 0)) return;
  backfilling.add(accountId);
  update(accountId, { ...laneStatus(accountId), synced: 0, total: null });
  broadcast("gmail:sync-started");
  const backfill = provider.backfill.bind(provider);
  void provider
    .background("backfill", () =>
      backfill(accountId, {
        update: (patch) => update(accountId, patch),
        bumpRevision: () => bumpRevision(accountId),
        assertActive: () => assertActive(accountId),
        newMail: async () => {},
      }),
    )
    .then(
      () => {
        backfillFailures.delete(accountId);
        backfilling.delete(accountId);
        update(accountId, {
          ...laneStatus(accountId),
          error: null,
          fullSyncDone: store.getSyncState(accountId).fullSyncDone,
        });
        bumpRevision(accountId);
        syncAccount(accountId, { force: true });
      },
      (err: unknown) => {
        backfilling.delete(accountId);
        if (err instanceof SyncCancelled) {
          logger.info("mail-sync", err.message);
          return;
        }
        recordFailure(accountId, backfillFailures);
        const reason = describeSyncError(accountId, err);
        logger[syncFailureLevel(provider, err)](
          "mail-sync",
          `${provider.kind} backfill failed for ${accountId}: ${reason}`,
          err,
        );
        update(accountId, {
          ...laneStatus(accountId),
          error: reason,
          signInNeeded: needsSignIn(accountId, provider, err),
        });
      },
    );
}

const PREFETCH_MAX_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Cache the attachment bytes of every draft (drafts are few and editing one
 * re-uploads its files, so they must be in memory before the composer can
 * save). Other mail keeps fetching attachments lazily — getAttachmentData
 * write-through means anything opened once is cached from then on.
 */
async function prefetchDraftAttachments(accountId: string, provider: MailProvider): Promise<void> {
  for (const id of store.getMessageIdsForLabel(accountId, "DRAFT")) {
    assertActive(accountId);
    try {
      let detail = store.getMessageDetail(accountId, id);
      if (!detail) {
        detail = await provider.getMessage(accountId, id);
        assertActive(accountId);
        store.upsertMessageDetail(accountId, detail);
      }
      for (const att of detail.attachments) {
        if (att.size > PREFETCH_MAX_FILE_BYTES) continue;
        if (await hasCachedAttachment(accountId, id, att.id)) continue;
        await getAttachmentData(accountId, id, att.id);
      }
    } catch (err) {
      if (err instanceof SyncCancelled) throw err;
      logger.info(
        "mail-sync",
        `draft attachment prefetch skipped ${id}: ${describeSyncError(accountId, err)}`,
      );
    }
  }
}

// Full bodies for every message, newest first, so the whole mailbox reads
// offline. Runs as prefetch work (after the user and sync in the quota
// queue), in its own lane: a big backlog takes a while and must not keep the
// account "syncing" or delay new mail. A pass stops when the server pushes
// back (rate limit, offline) and the next sync starts a new one.

const downloading = new Set<string>();
const DOWNLOAD_CHUNK = 60;
const DOWNLOAD_CONCURRENCY = 6;

function startDownloads(accountId: string, provider: MailProvider): void {
  if (downloading.has(accountId) || removed.has(accountId)) return;
  downloading.add(accountId);
  void provider
    .background("prefetch", () => downloadBodies(accountId, provider))
    .catch((err: unknown) => {
      if (err instanceof SyncCancelled) return;
      logger.info(
        "mail-sync",
        `offline download paused for ${accountId}: ${describeSyncError(accountId, err)}`,
      );
    })
    .finally(() => {
      downloading.delete(accountId);
      if (statuses.has(accountId)) update(accountId, { download: null });
    });
}

async function downloadBodies(accountId: string, provider: MailProvider): Promise<void> {
  const total = platform().syncPolicy.bodyPrefetch ? store.countUndownloaded(accountId) : 0;
  if (total > 0) {
    let done = 0;
    const attempted = new Set<string>();
    const singly = new Set<string>();
    update(accountId, { download: { done, total } });
    for (;;) {
      assertActive(accountId);
      if (provider.isCoolingDown?.(accountId)) break;
      const batch = store
        .getUndownloadedMessages(accountId, DOWNLOAD_CHUNK)
        .filter((m) => !attempted.has(m.id));
      if (batch.length === 0) break;
      const threads = new Map<string, string[]>();
      for (const m of batch) {
        const key = provider.getThread && !singly.has(m.id) ? m.threadId : m.id;
        threads.set(key, [...(threads.get(key) ?? []), m.id]);
      }
      const jobs: { threadId: string | null; ids: string[] }[] = [...threads].map(
        ([threadId, ids]) => ({ threadId: ids.length > 1 ? threadId : null, ids }),
      );
      let pushedBack = false;
      const details: MessageDetail[] = [];
      await mapPool(jobs, DOWNLOAD_CONCURRENCY, async ({ threadId, ids }) => {
        if (pushedBack || removed.has(accountId)) return;
        for (const id of ids) attempted.add(id);
        const id = ids[0]!;
        try {
          if (threadId) details.push(...(await provider.getThread!(accountId, threadId)));
          else details.push(await provider.getMessage(accountId, id));
        } catch (err) {
          if (err instanceof SyncCancelled) throw err;
          const kind = provider.errorKind(err);
          if (
            kind === "rateLimit" ||
            kind === "network" ||
            kind === "auth" ||
            !isSignedIn(accountId)
          ) {
            for (const each of ids) attempted.delete(each);
            pushedBack = true;
          } else if (threadId) {
            for (const each of ids) {
              attempted.delete(each);
              singly.add(each);
            }
            return;
          } else if (kind === "notFound") {
            forgetMessage(accountId, id);
          } else {
            logger.info(
              "mail-sync",
              `body fetch failed for ${id}: ${describeSyncError(accountId, err)}`,
            );
            store.markBodyFetchFailed(accountId, id);
          }
        }
        done += ids.length;
        update(accountId, { download: { done: Math.min(done, total), total } });
      });
      assertActive(accountId);
      const gone = new Set(
        store.filterUnknownIds(
          accountId,
          details.map((m) => m.id),
        ),
      );
      store.upsertMessageDetails(
        accountId,
        details.filter((m) => !gone.has(m.id)),
      );
      if (pushedBack) break;
    }
  }

  await prefetchDraftAttachments(accountId, provider);
}
