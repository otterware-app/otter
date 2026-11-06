// A delta removal can mean a move: look up the immutable message id before deleting its cached copy.

import { logger } from "../../logger.js";
import {
  BACKGROUND_MAX_MESSAGES,
  cacheWindow,
  getCoverage,
  inBackground,
  setCoverage,
  windowStart,
} from "../../services/coverage.js";
import * as store from "../../services/mail-store.js";
import type { MessageSummary } from "../../types.js";
import { hasPendingLabelWrites } from "../../services/pending-label-writes.js";
import { SyncCancelled, type SyncContext } from "../provider.js";
import {
  FOLDER_PREFIX,
  isSyncedFolder,
  labelsOf,
  mailboxOf,
  readMailbox,
  skippedFolderIds,
  type Folder,
  type Mailbox,
} from "./folders.js";
import { GraphError, graph, graphAll, isAccessDenied, type Page } from "./graph.js";
import {
  findApiMessages,
  getApiMessages,
  REGULAR_ID_PREFIXES,
  SUMMARY_FIELDS,
  toImmutableIds,
  toSummary,
  type ApiMessage,
} from "./messages.js";

const PAGE_SIZE = 100;

type FolderDelta = { link: string; done: boolean; label?: string | null; unlisted?: string[] };
type DeltaState = Record<string, FolderDelta>;

const deltaKey = (accountId: string) => `outlookDelta:${accountId}`;
const peekedKey = (accountId: string) => `outlookPeeked:${accountId}`;

function readDelta(accountId: string): DeltaState {
  try {
    return JSON.parse(store.getKv(deltaKey(accountId)) || "{}") as DeltaState;
  } catch {
    return {};
  }
}

function writeDelta(accountId: string, state: DeltaState): void {
  store.setKv(deltaKey(accountId), JSON.stringify(state));
}

function setFolderDelta(accountId: string, folderId: string, delta: FolderDelta | null): void {
  const state = readDelta(accountId);
  if (delta) state[folderId] = delta;
  else delete state[folderId];
  writeDelta(accountId, state);
}

/**
 * Folders Outlook won't let this sign-in read (a locked system folder, say),
 * skipped for a while rather than taken for a sign-out: the rest of the
 * mailbox keeps syncing. The inbox refusing, or a 401, still means signed out.
 */
const REFUSED_RETRY_MS = 60 * 60_000;
const refused = new Map<string, number>();
const refusedKey = (accountId: string, folderId: string) => `${accountId}\n${folderId}`;
const isRefused = (accountId: string, folderId: string) =>
  Date.now() < (refused.get(refusedKey(accountId, folderId)) ?? 0);

/** Whether `err`, from reading the folder itself, was Outlook refusing it; then it's skipped. */
function refuse(accountId: string, folder: Folder, mailbox: Mailbox, err: unknown): boolean {
  if (!isAccessDenied(err) || folder.id === mailbox.wellKnown.inbox) return false;
  logger.warn("outlook-sync", `Outlook refused a folder of ${accountId}; skipping it for now`, {
    folder: folder.name,
    error: (err as Error).message,
  });
  refused.set(refusedKey(accountId, folder.id), Date.now() + REFUSED_RETRY_MS);
  return true;
}

const firstDelta = (folderId: string, since?: number) =>
  `/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=${SUMMARY_FIELDS}` +
  (since === undefined
    ? ""
    : `&$filter=${encodeURIComponent(`receivedDateTime ge ${new Date(since).toISOString()}`)}`);

/** With a window, where its mail starts, kept so every folder's delta asks for the same. */
function windowSince(accountId: string): number | undefined {
  const window = cacheWindow();
  if (!window) return undefined;
  const coverage = getCoverage(accountId);
  if (coverage) return coverage.since;
  const since = windowStart(window);
  setCoverage(accountId, { since, done: false });
  return since;
}

export function forgetOutlookSync(accountId: string): void {
  folderRefresh.delete(accountId);
  for (const key of refused.keys()) if (key.startsWith(`${accountId}\n`)) refused.delete(key);
}

// The folder tree (names, Outlook's counts) and categories take a few
// requests: re-read when mail changed (at most every 30 seconds) and every 2
// minutes, so folders and categories made elsewhere show up soon.

const FOLDERS_MIN_GAP_MS = 30_000;
const FOLDERS_MAX_AGE_MS = 2 * 60_000;
const folderRefresh = new Map<string, { at: number; dirty: boolean }>();

async function refreshFolders(
  accountId: string,
  mailChanged: boolean,
  ctx: SyncContext,
): Promise<Mailbox> {
  const before = mailboxOf(accountId);
  let state = folderRefresh.get(accountId);
  if (!state) folderRefresh.set(accountId, (state = { at: 0, dirty: true }));
  if (mailChanged) state.dirty = true;
  const age = Date.now() - state.at;
  if (before && age < FOLDERS_MAX_AGE_MS && !(state.dirty && age > FOLDERS_MIN_GAP_MS)) {
    return before;
  }
  const mailbox = await readMailbox(accountId);
  ctx.assertActive();
  state.at = Date.now();
  state.dirty = false;
  followFolderChanges(accountId, before, mailbox);
  store.upsertLabels(accountId, labelsOf(accountId, mailbox));
  ctx.bumpRevision();
  return mailbox;
}

function followFolderChanges(accountId: string, before: Mailbox | null, after: Mailbox): void {
  if (!before) return;
  const now = new Set(after.folders.map((f) => f.id));
  const delta = readDelta(accountId);
  for (const folder of before.folders) {
    if (now.has(folder.id)) continue;
    delete delta[folder.id];
    if (folder.labelId?.startsWith(FOLDER_PREFIX)) {
      const ids = store.getMessageIdsForLabel(accountId, folder.labelId);
      store.applyHistoryChanges(
        accountId,
        ids.map((id) => ({ kind: "deleted", id })),
      );
    }
  }
  writeDelta(accountId, delta);
}

/**
 * A folder whose label changed (moved into Deleted Items, say, or the
 * Archive, which had none before ARCHIVE) moves its cached mail to the new
 * label. The cache can't tell which mail had none: Outlook lists the folder.
 */
async function relabelFolders(accountId: string, mailbox: Mailbox, ctx: SyncContext) {
  for (const folder of mailbox.folders) {
    const state = readDelta(accountId)[folder.id];
    if (!state || isRefused(accountId, folder.id)) continue;
    // Listed before folders kept their label: only the Archive's has changed since.
    const had =
      state.label !== undefined
        ? state.label
        : folder.id === mailbox.wellKnown.archive
          ? null
          : folder.labelId;
    if (had !== folder.labelId) {
      let ids: { id: string }[];
      try {
        ids = await graphAll<{ id: string }>(
          accountId,
          `/me/mailFolders/${encodeURIComponent(folder.id)}/messages?$select=id&$top=500`,
        );
      } catch (err) {
        if (refuse(accountId, folder, mailbox, err)) continue;
        throw err;
      }
      ctx.assertActive();
      store.applyHistoryChanges(
        accountId,
        ids.flatMap(({ id }) => [
          ...(had ? [{ kind: "labelsRemoved" as const, id, labelIds: [had] }] : []),
          ...(folder.labelId
            ? [{ kind: "labelsAdded" as const, id, labelIds: [folder.labelId] }]
            : []),
        ]),
      );
      ctx.bumpRevision();
    }
    if (state.label !== folder.labelId) {
      setFolderDelta(accountId, folder.id, { ...state, label: folder.labelId });
    }
  }
}

export async function syncOutlook(accountId: string, ctx: SyncContext): Promise<void> {
  if (inBackground()) return followInbox(accountId, ctx);
  ctx.update({ phase: mailboxOf(accountId) ? "incremental" : "labels" });
  const mailbox = await refreshFolders(accountId, false, ctx);
  await relabelFolders(accountId, mailbox, ctx);
  await repairRegularIds(accountId, ctx);
  dropSkippedFolderMail(accountId, ctx);
  if (store.getKv(peekedKey(accountId)) !== "1") await peekInbox(accountId, mailbox, ctx);

  ctx.update({ phase: "incremental", synced: 0 });
  const delta = readDelta(accountId);
  const added: MessageSummary[] = [];
  let changed = false;
  for (const folder of mailbox.folders) {
    const state = delta[folder.id];
    if (!state?.done || isRefused(accountId, folder.id)) continue;
    const result = await followDelta(accountId, mailbox, folder, state.link, ctx);
    added.push(...result.added);
    changed ||= result.changed;
  }
  if (changed) {
    ctx.bumpRevision();
    await refreshFolders(accountId, true, ctx);
  }
  await ctx.newMail(added.filter((m) => m.labelIds.includes("INBOX")));
}

/** Behind the app: only the inbox's delta, and only a page or so of it. */
async function followInbox(accountId: string, ctx: SyncContext): Promise<void> {
  const mailbox = mailboxOf(accountId);
  const inbox = mailbox?.folders.find((f) => f.id === mailbox.wellKnown.inbox);
  const state = inbox && readDelta(accountId)[inbox.id];
  if (!mailbox || !inbox || !state?.done) return;
  ctx.update({ phase: "incremental", synced: 0 });
  const result = await followDelta(accountId, mailbox, inbox, state.link, ctx, true);
  if (result.changed) ctx.bumpRevision();
  await ctx.newMail(result.added.filter((m) => m.labelIds.includes("INBOX")));
}

/**
 * The inbox's newest page, before the folders' deltas list everything. With a
 * window, as many pages as its `minThreads` take, however old they are.
 */
async function peekInbox(accountId: string, mailbox: Mailbox, ctx: SyncContext): Promise<void> {
  const inbox = mailbox.wellKnown.inbox!;
  const window = cacheWindow();
  let next: string | undefined =
    `/me/mailFolders/${encodeURIComponent(inbox)}/messages?$top=50&$orderby=receivedDateTime desc&$select=${SUMMARY_FIELDS}`;
  while (next) {
    const page: Page<ApiMessage> = await graph<Page<ApiMessage>>(accountId, next);
    ctx.assertActive();
    store.upsertMessages(
      accountId,
      (page.value ?? []).map((m) => toSummary(accountId, m)),
    );
    next =
      window && store.countThreads(accountId) < window.minThreads
        ? page["@odata.nextLink"]
        : undefined;
  }
  store.recountLabels(accountId, ["INBOX", "UNREAD", "STARRED", "IMPORTANT"]);
  store.setKv(peekedKey(accountId), "1");
  ctx.bumpRevision();
}

/**
 * Replays a folder's delta from its link. Every page is read before anything
 * is written, so a failure midway leaves the link and the cache as they were
 * and the next run asks again.
 */
async function followDelta(
  accountId: string,
  mailbox: Mailbox,
  folder: Folder,
  link: string,
  ctx: SyncContext,
  bounded = false,
): Promise<{ added: MessageSummary[]; changed: boolean }> {
  const present: ApiMessage[] = [];
  const removed: string[] = [];
  let next: string | undefined = link;
  let deltaLink = link;
  try {
    while (next) {
      const page: Page<ApiMessage> = await graph<Page<ApiMessage>>(accountId, next, {
        prefer: [`odata.maxpagesize=${PAGE_SIZE}`],
      });
      for (const message of page.value ?? []) {
        if (message["@removed"]) removed.push(message.id);
        else present.push(message);
      }
      next = page["@odata.nextLink"];
      if (page["@odata.deltaLink"]) deltaLink = page["@odata.deltaLink"];
      // A next link resumes the round where it stopped: the rest waits for the front.
      if (bounded && next && present.length + removed.length >= BACKGROUND_MAX_MESSAGES) {
        deltaLink = next;
        break;
      }
    }
  } catch (err) {
    if (err instanceof GraphError && (err.status === 410 || /syncState|resync/i.test(err.code))) {
      logger.info("outlook-sync", `delta expired for a folder of ${accountId}; listing it again`);
      setFolderDelta(accountId, folder.id, {
        link: firstDelta(folder.id, windowSince(accountId)),
        done: false,
        label: folder.labelId,
        unlisted: folder.labelId ? store.getMessageIdsForLabel(accountId, folder.labelId) : [],
      });
      return { added: [], changed: false };
    }
    if (refuse(accountId, folder, mailbox, err)) return { added: [], changed: false };
    throw err;
  }

  ctx.assertActive();
  // Read/flag changes can carry only part of a message. Resolve the current
  // summaries in batches before replacing any cached headers or labels.
  const summaries = (
    await getApiMessages(accountId, [...new Set(present.map((m) => m.id))], SUMMARY_FIELDS, true)
  ).map((m) => toSummary(accountId, m));
  ctx.assertActive();
  const fresh = new Set(
    store.filterUnknownIds(
      accountId,
      summaries.map((m) => m.id),
    ),
  );
  const touched = new Set<string>();
  for (const m of summaries) {
    for (const l of store.getMessageLabelIds(accountId, m.id) ?? []) touched.add(l);
  }
  store.upsertMessages(accountId, summaries);
  for (const m of summaries) for (const l of m.labelIds) touched.add(l);

  const gone = removed.filter((id) => !present.some((m) => m.id === id));
  if (gone.length > 0) {
    const found = new Map(
      (await getApiMessages(accountId, gone, SUMMARY_FIELDS, true)).map((m) => [m.id, m]),
    );
    ctx.assertActive();
    const ops: store.HistoryOp[] = [];
    const moved: MessageSummary[] = [];
    for (const id of gone) {
      const message = found.get(id);
      if (!message || !isSyncedFolder(accountId, message.parentFolderId)) {
        ops.push({ kind: "deleted", id });
      } else moved.push(toSummary(accountId, message));
    }
    for (const id of gone) {
      for (const l of store.getMessageLabelIds(accountId, id) ?? []) touched.add(l);
    }
    store.applyHistoryChanges(accountId, ops);
    store.upsertMessages(accountId, moved);
    for (const m of moved) for (const l of m.labelIds) touched.add(l);
  }
  store.recountLabels(accountId, [...touched]);
  setFolderDelta(accountId, folder.id, {
    ...readDelta(accountId)[folder.id],
    link: deltaLink,
    done: true,
  });
  ctx.update({ synced: summaries.length });
  return {
    added: summaries.filter((m) => fresh.has(m.id) && m.unread),
    changed: summaries.length > 0 || gone.length > 0,
  };
}

export function needsBackfill(accountId: string): boolean {
  const mailbox = mailboxOf(accountId);
  if (!mailbox) return false;
  const delta = readDelta(accountId);
  return mailbox.folders.some((f) => !delta[f.id]?.done && !isRefused(accountId, f.id));
}

export async function backfillOutlook(accountId: string, ctx: SyncContext): Promise<void> {
  const mailbox = mailboxOf(accountId);
  if (!mailbox) return;
  const total = mailbox.folders.reduce((sum, f) => sum + f.total, 0);
  const since = windowSince(accountId);
  let count = store.countAllMessages(accountId);
  ctx.update({ phase: "full", synced: count, total: total || null });
  let skipped = false;
  for (const folder of mailbox.folders) {
    if (isRefused(accountId, folder.id)) {
      skipped = true;
      continue;
    }
    const state = readDelta(accountId)[folder.id];
    if (state?.done) continue;
    let next: string | undefined = state?.link ?? firstDelta(folder.id, since);
    while (next) {
      let page: Page<ApiMessage>;
      try {
        page = await graph<Page<ApiMessage>>(accountId, next, {
          prefer: [`odata.maxpagesize=${PAGE_SIZE}`],
        });
      } catch (err) {
        if (!refuse(accountId, folder, mailbox, err)) throw err;
        skipped = true;
        break;
      }
      ctx.assertActive();
      const summaries = (page.value ?? [])
        .filter((m) => !m["@removed"] && isSyncedFolder(accountId, m.parentFolderId))
        .map((m) => toSummary(accountId, m));
      const unknown = new Set(
        store.filterUnknownIds(
          accountId,
          summaries.map((m) => m.id),
        ),
      );
      store.upsertMessages(accountId, summaries);
      count += unknown.size;
      next = page["@odata.nextLink"];
      const before = readDelta(accountId)[folder.id] ?? { label: folder.labelId };
      let unlisted = before.unlisted;
      if (unlisted) {
        const listed = new Set(summaries.map((m) => m.id));
        const removed = (page.value ?? []).filter((m) => m["@removed"]).map((m) => m.id);
        const unknownRemoved = new Set(store.filterUnknownIds(accountId, removed));
        unlisted = [
          ...new Set([
            ...unlisted.filter((id) => !listed.has(id)),
            ...removed.filter((id) => !unknownRemoved.has(id)),
          ]),
        ];
        if (!next) {
          await reconcileUnlisted(accountId, unlisted, ctx);
          unlisted = undefined;
        }
      }
      setFolderDelta(accountId, folder.id, {
        ...before,
        link: next ?? page["@odata.deltaLink"] ?? firstDelta(folder.id, since),
        done: !next,
        unlisted,
      });
      ctx.update({ synced: count });
      if (summaries.length > 0) ctx.bumpRevision();
    }
  }
  ctx.assertActive();
  store.recountLabels(
    accountId,
    labelsOf(accountId, mailbox).map((l) => l.id),
  );
  store.upsertLabels(accountId, labelsOf(accountId, mailbox));
  // Not done while a folder is skipped: lists keep paging from Outlook, and it's asked again later.
  // A window filled is never the whole mailbox: lists page past it from Outlook.
  if (!skipped && since !== undefined) setCoverage(accountId, { since, done: true });
  else if (!skipped) store.setSyncState(accountId, { fullSyncDone: true });
  ctx.bumpRevision();
  logger.info(
    "outlook-sync",
    `listed ${skipped ? "the folders it may read" : "every folder"} of ${accountId}`,
  );
}

async function reconcileUnlisted(
  accountId: string,
  ids: string[],
  ctx: SyncContext,
): Promise<void> {
  if (ids.length === 0) return;
  const { found, gone } = await findApiMessages(accountId, ids);
  ctx.assertActive();
  const synced = found.filter((m) => isSyncedFolder(accountId, m.parentFolderId));
  const kept = new Set(synced.map((m) => m.id));
  store.applyHistoryChanges(accountId, [
    ...gone.map((id) => ({ kind: "deleted" as const, id })),
    ...found.filter((m) => !kept.has(m.id)).map((m) => ({ kind: "deleted" as const, id: m.id })),
  ]);
  store.upsertMessages(
    accountId,
    synced.map((m) => toSummary(accountId, m)),
  );
  ctx.bumpRevision();
}

async function repairRegularIds(accountId: string, ctx: SyncContext): Promise<void> {
  const regular = REGULAR_ID_PREFIXES.flatMap((prefix) =>
    store.getMessageIdsWithPrefix(accountId, prefix),
  );
  if (regular.length === 0 || hasPendingLabelWrites(accountId)) return;
  let immutable: Map<string, string>;
  let gone: string[];
  let fresh: ApiMessage[];
  try {
    immutable = await toImmutableIds(accountId, regular);
    ({ gone } = await findApiMessages(
      accountId,
      regular.filter((id) => !immutable.has(id)),
    ));
    fresh = await getApiMessages(accountId, [...new Set(immutable.values())], SUMMARY_FIELDS, true);
  } catch (err) {
    if (err instanceof SyncCancelled) throw err;
    logger.warn("outlook-sync", `couldn't repair regular ids of ${accountId}; trying next sync`, {
      error: (err as Error).message,
    });
    return;
  }
  ctx.assertActive();
  const replaced = new Set(fresh.map((m) => m.id));
  const dropped = [
    ...regular.filter((id) => {
      const target = immutable.get(id);
      return target && (replaced.has(target) || store.getMessageLabelIds(accountId, target));
    }),
    ...gone,
  ];
  const touched = new Set(dropped.flatMap((id) => store.getMessageLabelIds(accountId, id) ?? []));
  store.applyHistoryChanges(
    accountId,
    dropped.map((id) => ({ kind: "deleted" as const, id })),
  );
  const summaries = fresh.map((m) => toSummary(accountId, m));
  store.upsertMessages(accountId, summaries);
  for (const m of summaries) for (const l of m.labelIds) touched.add(l);
  store.recountLabels(accountId, [...touched]);
  ctx.bumpRevision();
}

function dropSkippedFolderMail(accountId: string, ctx: SyncContext): void {
  const ids = skippedFolderIds(accountId).flatMap((folderId) =>
    store.getMessageIdsForLabel(accountId, `${FOLDER_PREFIX}${folderId}`),
  );
  if (ids.length === 0) return;
  store.applyHistoryChanges(
    accountId,
    ids.map((id) => ({ kind: "deleted" as const, id })),
  );
  ctx.bumpRevision();
}
