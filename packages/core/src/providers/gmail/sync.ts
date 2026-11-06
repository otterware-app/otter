// Replay history from the backfill seed after it finishes so newer changes overwrite older backfill copies.

import { logger } from "../../logger.js";
import { platform, type CoverageWindow } from "../../platform.js";
import {
  BACKGROUND_MAX_MESSAGES,
  BACKGROUND_MAX_PAGES,
  cacheWindow,
  getCoverage,
  inBackground,
  setCoverage,
  windowReached,
  windowStart,
} from "../../services/coverage.js";
import * as store from "../../services/mail-store.js";
import type { MessageSummary } from "../../types.js";
import { SyncCancelled, type SyncContext } from "../provider.js";
import {
  describeError,
  fetchMessagesForIds,
  fetchMetadataForIds,
  getProfile,
  isHistoryExpiredError,
  listDraftIds,
  listHistory,
  listLabelNames,
  listLabels,
  listMessageIdsPage,
} from "./api.js";
import { fillOverImap } from "./imap-fill.js";

// Kept in kv, so a backfill survives quitting and picks up where it stopped.
const seedKey = (accountId: string) => `fullSyncSeed:${accountId}`;
const cursorKey = (accountId: string) => `fullSyncCursor:${accountId}`;
const refreshKey = (accountId: string) => `fullSyncRefresh:${accountId}`;
const replayKey = (accountId: string) => `replayFrom:${accountId}`;
const spamTrashKey = (accountId: string) => `spamTrashBackfilled:${accountId}`;

export async function syncGmail(accountId: string, ctx: SyncContext): Promise<void> {
  ctx.update({ phase: "incremental" });
  let historyId = store.getSyncState(accountId).historyId;
  if (inBackground()) {
    if (historyId)
      await ctx.newMail((await incrementalSync(accountId, historyId, ctx, true)).added);
    return;
  }
  if (!historyId) {
    // A new mailbox. Labels first — the sidebar and message chips depend on
    // them; then the feed starts now, and a backfill lists what came before.
    ctx.update({ phase: "labels" });
    if (await refreshLabels(accountId, true, ctx)) ctx.bumpRevision();
    historyId = await startFeed(accountId, ctx);
  }

  const delta = await incrementalSync(accountId, historyId, ctx);
  if (await refreshLabels(accountId, delta.changed, ctx)) ctx.bumpRevision();
  await ctx.newMail(delta.added);

  await learnDraftIds(accountId, delta.changed, ctx);
}

export function needsBackfill(accountId: string): boolean {
  if (cacheWindow()) {
    return store.getKv(refreshKey(accountId)) === "1" || !getCoverage(accountId)?.done;
  }
  return (
    !store.getSyncState(accountId).fullSyncDone ||
    store.getKv(refreshKey(accountId)) === "1" ||
    store.getKv(spamTrashKey(accountId)) !== "1"
  );
}

export async function backfillGmail(accountId: string, ctx: SyncContext): Promise<void> {
  // The feed starts first (syncGmail), so nothing is missed meanwhile.
  if (!store.getSyncState(accountId).historyId) return;
  const window = cacheWindow();
  if (window) {
    if (store.getKv(refreshKey(accountId)) === "1") await refreshWindow(accountId, window, ctx);
    else if (!getCoverage(accountId)?.done) await fillWindow(accountId, window, ctx);
    return;
  }
  if (store.getKv(refreshKey(accountId)) === "1") await refreshMailbox(accountId, ctx);
  else if (!store.getSyncState(accountId).fullSyncDone) await fillMailbox(accountId, ctx);
  if (store.getKv(spamTrashKey(accountId)) !== "1") await backfillSpamTrash(accountId, ctx);
}

async function startFeed(accountId: string, ctx: SyncContext): Promise<string> {
  const seed = (await getProfile(accountId)).historyId;
  if (!seed) throw new Error("Gmail didn't say where the mailbox's history starts.");
  ctx.assertActive();
  store.setKv(seedKey(accountId), seed);
  store.setSyncState(accountId, { historyId: seed });
  return seed;
}

function finishBackfill(accountId: string): void {
  const seed = store.getKv(seedKey(accountId));
  store.setSyncState(accountId, { fullSyncDone: true });
  if (seed) store.setKv(replayKey(accountId), seed);
  store.setKv(seedKey(accountId), "");
  store.setKv(cursorKey(accountId), "");
  store.setKv(refreshKey(accountId), "");
}

async function fetchAndStore(
  accountId: string,
  ids: string[],
  ctx: SyncContext,
  skipCached = false,
): Promise<MessageSummary[]> {
  const uncached = <T extends MessageSummary>(fetched: T[]): T[] => {
    if (!skipCached) return fetched;
    const unknown = new Set(
      store.filterUnknownIds(
        accountId,
        fetched.map((m) => m.id),
      ),
    );
    return fetched.filter((m) => unknown.has(m.id));
  };
  if (platform().syncPolicy.bodyPrefetch) {
    const details = await fetchMessagesForIds(accountId, ids);
    ctx.assertActive();
    store.upsertMessageDetails(accountId, uncached(details));
    return details;
  }
  const summaries = await fetchMetadataForIds(accountId, ids);
  ctx.assertActive();
  store.upsertMessages(accountId, uncached(summaries));
  return summaries;
}

export function forgetGmailSync(accountId: string): void {
  labelRefresh.delete(accountId);
  draftCheckAt.delete(accountId);
}

const LABEL_DETAIL_MIN_GAP_MS = 60_000;
const LABEL_DETAIL_MAX_AGE_MS = 10 * 60_000;
const labelRefresh = new Map<string, { refreshedAt: number; dirty: boolean }>();

async function refreshLabels(
  accountId: string,
  mailChanged: boolean,
  ctx: SyncContext,
): Promise<boolean> {
  let state = labelRefresh.get(accountId);
  if (!state) {
    state = { refreshedAt: 0, dirty: true };
    labelRefresh.set(accountId, state);
  }
  if (mailChanged) state.dirty = true;
  const age = Date.now() - state.refreshedAt;
  let due = age > LABEL_DETAIL_MAX_AGE_MS || (state.dirty && age > LABEL_DETAIL_MIN_GAP_MS);
  if (!due) {
    const names = await listLabelNames(accountId);
    const cached = new Map(store.getLabels(accountId).map((l) => [l.id, l.name]));
    due = names.length !== cached.size || names.some((l) => cached.get(l.id) !== l.name);
  }
  if (!due) return false;
  const labels = await listLabels(accountId);
  ctx.assertActive();
  store.upsertLabels(accountId, labels);
  state.refreshedAt = Date.now();
  state.dirty = false;
  return true;
}

const META_CHUNK = 100;

/**
 * The first sync of a mailbox. With raw sockets (the desktop app), over IMAP
 * (every row in seconds), then the category labels IMAP doesn't carry.
 *
 * Otherwise through the API: the newest page of the inbox, then the whole
 * mailbox newest first (Spam and Trash after it: backfillSpamTrash), caching
 * what isn't cached yet, 100 messages at a time so lists fill in steadily.
 * Resumable: the page cursor is kept after every page, so a failure (rate
 * limits, sleep, quit) continues where it stopped instead of starting over.
 */
async function fillMailbox(accountId: string, ctx: SyncContext): Promise<void> {
  if (platform().rawSockets) {
    try {
      await fillOverImap(accountId, ctx);
      await fillCategories(accountId, ctx);
      ctx.assertActive();
      finishBackfill(accountId);
      store.setKv(spamTrashKey(accountId), "1");
      return;
    } catch (err) {
      if (err instanceof SyncCancelled) throw err;
      logger.info("mail-sync", `filling ${accountId} through the API: ${describeError(err)}`);
    }
  }

  let total: number | null = null;
  try {
    total = (await getProfile(accountId)).messagesTotal || null;
  } catch {
    // keep going without a total
  }

  // A window filled before (a policy widened since) goes on from where it stopped.
  let pageToken = store.getKv(cursorKey(accountId)) || getCoverage(accountId)?.cursor || undefined;
  let synced = store.countAllMessages(accountId);
  ctx.update({ phase: "full", synced, total });
  if (pageToken) logger.info("mail-sync", `full sync resuming for ${accountId} at ${synced}`);

  const inbox = await listMessageIdsPage(accountId, {
    labelIds: ["INBOX"],
    maxResults: 500,
    spamTrash: false,
  });
  const inboxFresh = store.filterUnknownIds(accountId, inbox.ids);
  for (let i = 0; i < inboxFresh.length; i += META_CHUNK) {
    synced += (await fetchAndStore(accountId, inboxFresh.slice(i, i + META_CHUNK), ctx, true))
      .length;
    ctx.update({ synced });
    ctx.bumpRevision();
  }

  for (;;) {
    let page: Awaited<ReturnType<typeof listMessageIdsPage>>;
    try {
      page = await listMessageIdsPage(accountId, { pageToken, maxResults: 500, spamTrash: false });
    } catch (err) {
      if (pageToken && err instanceof Error && err.message.includes("Gmail API error: 400")) {
        store.setKv(cursorKey(accountId), "");
        pageToken = undefined;
        continue;
      }
      throw err;
    }

    if (total === null && page.resultSizeEstimate) ctx.update({ total: page.resultSizeEstimate });

    const fresh = store.filterUnknownIds(accountId, page.ids);
    for (let i = 0; i < fresh.length; i += META_CHUNK) {
      synced += (await fetchAndStore(accountId, fresh.slice(i, i + META_CHUNK), ctx, true)).length;
      ctx.update({ synced });
      ctx.bumpRevision();
    }

    pageToken = page.nextPageToken;
    store.setKv(cursorKey(accountId), pageToken ?? "");
    if (!pageToken) break;
  }

  ctx.assertActive();
  finishBackfill(accountId);
}

const WINDOW_PAGE = 100;

/**
 * The first sync of a mailbox kept to a window: the newest page of the inbox,
 * then all mail newest first until it's past the window with `minThreads`
 * conversations cached. Resumable like fillMailbox: the page cursor is kept in
 * the coverage, never in the history feed's state, and stays there for a fill
 * of the whole mailbox to go on from.
 */
async function fillWindow(
  accountId: string,
  window: CoverageWindow,
  ctx: SyncContext,
): Promise<void> {
  const since = getCoverage(accountId)?.since ?? windowStart(window);
  let cursor = getCoverage(accountId)?.cursor;
  let synced = store.countAllMessages(accountId);
  ctx.update({ phase: "full", synced, total: null });
  const cacheUnknown = async (ids: string[]) => {
    const fresh = store.filterUnknownIds(accountId, ids);
    for (let i = 0; i < fresh.length; i += META_CHUNK) {
      synced += (await fetchAndStore(accountId, fresh.slice(i, i + META_CHUNK), ctx, true)).length;
      ctx.update({ synced });
      ctx.bumpRevision();
    }
  };

  if (!cursor) {
    const inbox = await listMessageIdsPage(accountId, {
      labelIds: ["INBOX"],
      maxResults: WINDOW_PAGE,
      spamTrash: false,
    });
    await cacheUnknown(inbox.ids);
  }
  for (;;) {
    if (inBackground()) return;
    let page: Awaited<ReturnType<typeof listMessageIdsPage>>;
    try {
      page = await listMessageIdsPage(accountId, {
        pageToken: cursor,
        maxResults: WINDOW_PAGE,
        spamTrash: false,
      });
    } catch (err) {
      if (cursor && err instanceof Error && err.message.includes("Gmail API error: 400")) {
        cursor = undefined;
        continue;
      }
      throw err;
    }
    await cacheUnknown(page.ids);
    const oldest = Math.min(...store.getMessageDates(accountId, page.ids).map((m) => m.date));
    cursor = page.nextPageToken;
    ctx.assertActive();
    setCoverage(accountId, { since, done: false, cursor });
    if (!cursor || windowReached(accountId, window, since, oldest)) break;
  }

  ctx.assertActive();
  setCoverage(accountId, { since, done: true, cursor });
  const seed = store.getKv(seedKey(accountId));
  if (seed) store.setKv(replayKey(accountId), seed);
  store.setKv(seedKey(accountId), "");
  logger.info("mail-sync", `filled ${accountId}'s window`);
}

/**
 * After the history feed expired, with a window: every cached message is
 * read again (the cache is small; what Gmail no longer has leaves it), then
 * the window fills anew from the newest mail.
 */
async function refreshWindow(
  accountId: string,
  window: CoverageWindow,
  ctx: SyncContext,
): Promise<void> {
  logger.info("mail-sync", `reading ${accountId}'s cache again`);
  ctx.update({ phase: "full", synced: 0, total: null });
  const cached = [...store.getAllMessageLabels(accountId).keys()];
  ctx.update({ total: cached.length });
  for (let i = 0; i < cached.length; i += META_CHUNK) {
    const chunk = cached.slice(i, i + META_CHUNK);
    const found = new Set((await fetchAndStore(accountId, chunk, ctx)).map((m) => m.id));
    store.applyHistoryChanges(
      accountId,
      chunk.filter((id) => !found.has(id)).map((id) => ({ kind: "deleted" as const, id })),
    );
    ctx.update({ synced: i + chunk.length });
    ctx.bumpRevision();
  }
  setCoverage(accountId, { since: windowStart(window), done: false });
  await fillWindow(accountId, window, ctx);
  if (getCoverage(accountId)?.done) store.setKv(refreshKey(accountId), "");
}

async function fillCategories(accountId: string, ctx: SyncContext): Promise<void> {
  for (const label of store.getLabels(accountId)) {
    if (!label.id.startsWith("CATEGORY_")) continue;
    const ids = await listAllIds(accountId, label.id);
    ctx.assertActive();
    store.applyHistoryChanges(
      accountId,
      ids.map((id) => ({ kind: "labelsAdded", id, labelIds: [label.id] })),
    );
  }
  ctx.bumpRevision();
}

/**
 * After the history feed expired, Gmail can't say what changed while we were
 * away, so the cache is compared with the mailbox by listing ids (every
 * message's, then each label's) rather than re-reading every message: a page
 * of 500 ids costs what one message does. Cached mail gets its labels as
 * listed, mail Gmail no longer has is dropped, and what the cache lacks is
 * fetched.
 */
async function refreshMailbox(accountId: string, ctx: SyncContext): Promise<void> {
  logger.info("mail-sync", `comparing ${accountId} with Gmail's listings`);
  ctx.update({ phase: "full", synced: 0, total: null });
  // What the cache held before listing; rows written after are the feed's,
  // newer than the listing.
  const cached = store.getAllMessageLabels(accountId);
  const all = await listAllIds(accountId);
  ctx.update({ total: all.length });
  const listed = new Set(all);
  const members = new Map<string, Set<string>>();
  for (const label of store.getLabels(accountId)) {
    members.set(label.id, new Set(await listAllIds(accountId, label.id)));
  }

  ctx.assertActive();
  const ops: store.HistoryOp[] = [];
  for (const [id, labelIds] of cached) {
    if (!listed.has(id)) {
      ops.push({ kind: "deleted", id });
      continue;
    }
    const has = new Set(labelIds);
    const add = [...members].filter(([l, ids]) => ids.has(id) && !has.has(l)).map(([l]) => l);
    const remove = labelIds.filter((l) => members.get(l)?.has(id) === false);
    if (add.length > 0) ops.push({ kind: "labelsAdded", id, labelIds: add });
    if (remove.length > 0) ops.push({ kind: "labelsRemoved", id, labelIds: remove });
  }
  store.applyHistoryChanges(accountId, ops);
  if (ops.length > 0) ctx.bumpRevision();
  logger.info("mail-sync", `${ops.length} changes found comparing ${accountId}`);

  const missing = all.filter((id) => !cached.has(id));
  let synced = all.length - missing.length;
  ctx.update({ synced });
  for (let i = 0; i < missing.length; i += META_CHUNK) {
    synced += (await fetchAndStore(accountId, missing.slice(i, i + META_CHUNK), ctx, true)).length;
    ctx.update({ synced });
    ctx.bumpRevision();
  }

  ctx.assertActive();
  finishBackfill(accountId);
}

async function listAllIds(accountId: string, labelId?: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIdsPage(accountId, {
      pageToken,
      labelIds: labelId ? [labelId] : undefined,
    });
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

const DRAFT_CHECK_MAX_AGE_MS = 10 * 60_000;
const draftCheckAt = new Map<string, number>();

/**
 * One cheap drafts.list: records each cached draft's id (opening a draft then
 * needs no Gmail lookup) and removes stale local draft rows — every draft
 * edit mints a new message id, so older copies (and drafts sent or deleted
 * elsewhere) would otherwise linger in Drafts and its count. Runs when the
 * history feed reported changes (drafts show up there) or every 10 minutes.
 */
async function learnDraftIds(
  accountId: string,
  mailChanged: boolean,
  ctx: SyncContext,
): Promise<void> {
  if (!mailChanged && Date.now() - (draftCheckAt.get(accountId) ?? 0) < DRAFT_CHECK_MAX_AGE_MS) {
    return;
  }
  const local = store.getMessageIdsForLabel(accountId, "DRAFT");
  if (local.length === 0) return;
  try {
    const listedAt = Date.now();
    const drafts = await listDraftIds(accountId);
    ctx.assertActive();
    draftCheckAt.set(accountId, listedAt);
    for (const d of drafts) store.setDraftId(accountId, d.messageId, d.draftId);
    if (drafts.length < 500) {
      const current = new Set(drafts.map((d) => d.messageId));
      const stale = store
        .getMessageDates(accountId, local)
        .filter((m) => !current.has(m.id) && m.date < listedAt - 60_000)
        .map((m) => m.id);
      for (const id of stale) store.deleteMessage(accountId, id);
      if (stale.length > 0) {
        logger.info("mail-sync", `removed ${stale.length} stale draft rows`);
        ctx.bumpRevision();
      }
    }
  } catch (err) {
    if (err instanceof SyncCancelled) throw err;
    logger.info("mail-sync", `draft id refresh skipped: ${describeError(err)}`);
  }
}

async function backfillSpamTrash(accountId: string, ctx: SyncContext): Promise<void> {
  for (const labelId of ["SPAM", "TRASH"]) {
    let pageToken: string | undefined;
    do {
      const page = await listMessageIdsPage(accountId, { pageToken, labelIds: [labelId] });
      const fresh = store.filterUnknownIds(accountId, page.ids);
      if (fresh.length > 0) {
        await fetchAndStore(accountId, fresh, ctx, true);
        ctx.bumpRevision();
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  store.setKv(spamTrashKey(accountId), "1");
  logger.info("mail-sync", `spam/trash backfill done for ${accountId}`);
}

/**
 * Replays the history feed since `historyId` (or since the seed of a backfill
 * that just finished). All pages are read before anything is written, so a
 * failure mid-feed leaves the cursor and cache untouched and the next run
 * replays the same delta. Returns the newly added messages and whether
 * anything changed.
 */
async function incrementalSync(
  accountId: string,
  historyId: string,
  ctx: SyncContext,
  bounded = false,
): Promise<{ added: MessageSummary[]; changed: boolean }> {
  ctx.update({ phase: "incremental", synced: 0 });

  const replay = store.getKv(replayKey(accountId)) || null;
  const startHistoryId = replay ?? historyId;
  const addedIds = new Set<string>();
  const ops: store.HistoryOp[] = [];
  let latestHistoryId = startHistoryId;
  let pageToken: string | undefined;
  // Bounded (behind the app): up to a few pages and messages, ending on a
  // whole entry, so the feed goes on from that entry's id next time.
  let pages = 0;
  let lastEntry: string | null = null;
  let cut = false;

  try {
    feed: do {
      const page = await listHistory(accountId, startHistoryId, pageToken);
      if (page.historyId) latestHistoryId = page.historyId;
      pages += 1;

      for (const entry of page.history ?? []) {
        if (bounded && addedIds.size >= BACKGROUND_MAX_MESSAGES) {
          cut = true;
          break feed;
        }
        for (const added of entry.messagesAdded ?? []) {
          addedIds.add(added.message.id);
        }
        for (const deleted of entry.messagesDeleted ?? []) {
          ops.push({ kind: "deleted", id: deleted.message.id });
          addedIds.delete(deleted.message.id);
        }
        for (const change of entry.labelsAdded ?? []) {
          ops.push({ kind: "labelsAdded", id: change.message.id, labelIds: change.labelIds });
        }
        for (const change of entry.labelsRemoved ?? []) {
          ops.push({ kind: "labelsRemoved", id: change.message.id, labelIds: change.labelIds });
        }
        lastEntry = entry.id;
      }

      pageToken = page.nextPageToken;
      if (bounded && pageToken && pages >= BACKGROUND_MAX_PAGES) {
        cut = true;
        break;
      }
    } while (pageToken);
  } catch (err) {
    // Gmail purges history older than ~1 week: what changed meanwhile can't be
    // replayed. Start the feed over from now, and let a backfill compare the
    // cache with the mailbox.
    if (isHistoryExpiredError(err)) {
      await restartFeed(accountId, ctx);
      return { added: [], changed: false };
    }
    throw err;
  }

  ctx.assertActive();
  const { unknownIds } = store.applyHistoryChanges(accountId, ops);

  // New mail, plus mail the feed changed that the cache doesn't have (an
  // earlier run missed it, or a backfill hasn't got to it): both fetched with
  // current labels. A replay only needs what isn't cached; the rest just got
  // its changes.
  let ids = [...new Set([...addedIds, ...unknownIds])];
  if (replay) ids = store.filterUnknownIds(accountId, ids);
  let added: MessageSummary[] = [];
  if (ids.length > 0) {
    const fetched = await fetchAndStore(accountId, ids, ctx);
    store.recountLabels(
      accountId,
      fetched.flatMap((m) => m.labelIds),
    );
    added = fetched.filter((m) => addedIds.has(m.id));
    ctx.update({ synced: fetched.length });
  }

  const changed = ops.length > 0 || ids.length > 0;
  if (changed) ctx.bumpRevision();
  store.setSyncState(accountId, {
    historyId: cut ? (lastEntry ?? startHistoryId) : latestHistoryId,
  });
  if (replay && store.getKv(replayKey(accountId)) === replay) store.setKv(replayKey(accountId), "");
  return { added, changed };
}

async function restartFeed(accountId: string, ctx: SyncContext): Promise<void> {
  logger.info("mail-sync", `history expired for ${accountId}; refreshing the mailbox`);
  const { historyId } = await getProfile(accountId);
  if (!historyId) throw new Error("Gmail didn't say where the mailbox's history starts.");
  ctx.assertActive();
  store.setKv(seedKey(accountId), historyId);
  store.setKv(replayKey(accountId), "");
  store.setKv(refreshKey(accountId), "1");
  store.setSyncState(accountId, { historyId });
}
