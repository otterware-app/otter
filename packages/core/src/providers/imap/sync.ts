import { logger } from "../../logger.js";
import {
  ImapError,
  inUidRanges,
  type FetchedMessage,
  type ImapClient,
  type MailboxStatus,
  type SelectedMailbox,
  type UidRange,
} from "../../protocols/index.js";
import type { CoverageWindow } from "../../platform.js";
import {
  BACKGROUND_MAX_MESSAGES,
  cacheWindow,
  dropStaleCoverage,
  getCoverage,
  inBackground,
  setCoverage,
  windowStart,
} from "../../services/coverage.js";
import { hasPendingLabelWrites } from "../../services/pending-label-writes.js";
import * as store from "../../services/mail-store.js";
import type { MailLabel, MessageSummary } from "../../types.js";
import type { SyncContext } from "../provider.js";
import { FolderChanged, FolderGone, inFolder, withImap } from "./connection.js";
import {
  FLAG_LABELS,
  labelsFor,
  listFolders,
  messageId,
  parseMessageId,
  type Folder,
  type Folders,
} from "./folders.js";
import { DELIVERY_HEADERS, deliveryAddressesOf, SUMMARY_QUERY, toSummary } from "./messages.js";

const PAGE = 200;
/** Without mod-sequences, flags are only compared when STATUS changed, or this often. */
const FLAG_CHECK_MS = 15 * 60_000;

interface FolderState {
  uidValidity: number;
  uidNext: number;
  /** HIGHESTMODSEQ, as text (a bigint); absent on servers without CONDSTORE. */
  modseq?: string;
  below: number;
  /** Filled down to `below` as far as the cache's window goes. */
  covered?: boolean;
  label?: string | null;
  messages?: number | null;
  unseen?: number | null;
  checkedAt?: number;
}

type SyncState = Record<string, FolderState>;

const stateKey = (accountId: string) => `imapSync:${accountId}`;
const deliveredToKey = (accountId: string) => `imapDeliveredTo:${accountId}`;

function readState(accountId: string): SyncState {
  try {
    return JSON.parse(store.getKv(stateKey(accountId)) ?? "{}") as SyncState;
  } catch {
    return {};
  }
}

const writeState = (accountId: string, state: SyncState) =>
  store.setKv(stateKey(accountId), JSON.stringify(state));

/** Covered counts only while the cache keeps a window. */
const filled = (state: FolderState | undefined, windowed: boolean): state is FolderState =>
  state !== undefined && (state.below === 0 || (windowed && state.covered === true));

/** A bigger catch-up than a sync behind the app may do; the folder waits for the front. */
class Deferred extends Error {}

export async function syncImap(accountId: string, ctx: SyncContext): Promise<void> {
  ctx.update({ phase: "labels" });
  const { folders, statuses } = await readFolders(accountId);
  ctx.assertActive();
  if (writeLabels(accountId, labelsOf(folders, statuses))) ctx.bumpRevision();

  const state = readState(accountId);
  for (const [path, folderState] of Object.entries(state)) {
    if (folders.get(path)) continue;
    dropFolder(accountId, path, folderState.uidValidity);
    delete state[path];
    ctx.bumpRevision();
  }
  // Filled under another policy: every folder fills again from its newest mail.
  if (dropStaleCoverage(accountId)) {
    for (const folderState of Object.values(state)) {
      delete folderState.covered;
      folderState.below = folderState.uidNext;
    }
  }
  writeState(accountId, state);

  const window = cacheWindow();
  const bounded = inBackground();
  if (window && !getCoverage(accountId)) {
    setCoverage(accountId, { since: windowStart(window), done: false });
  }
  const first = window
    ? !getCoverage(accountId)?.done
    : !store.getSyncState(accountId).fullSyncDone;
  // Every summary of a mailbox new to the cache comes with its delivery headers.
  if (first && store.countAllMessages(accountId) === 0) {
    store.setKv(deliveredToKey(accountId), "1");
  }
  const total = [...statuses.values()].reduce((sum, s) => sum + (s.messages ?? 0), 0);
  ctx.update(
    first
      ? { phase: "full", synced: store.countAllMessages(accountId), total }
      : { phase: "incremental", synced: 0 },
  );

  const newMail: MessageSummary[] = [];
  let stopped = false;
  for (const folder of folders.synced) {
    if (stopped) break;
    if (bounded && (folder.role !== "INBOX" || !filled(state[folder.path], true))) continue;
    if (relabelFolder(accountId, folder, state[folder.path])) ctx.bumpRevision();
    const run = new FolderSync(accountId, folder, ctx, state[folder.path], window, bounded);
    let added: MessageSummary[];
    try {
      added = await run.sync(statuses.get(folder.path));
    } catch (err) {
      if (!(err instanceof FolderGone || err instanceof Deferred)) throw err;
      continue;
    }
    state[folder.path] = run.state!;
    writeState(accountId, state);
    if (folder.role === "INBOX") for (const message of added) newMail.push(message);
    stopped = run.stopped;
  }

  ctx.assertActive();
  store.recountLabels(accountId, ["STARRED", "UNREAD"]);
  if (first && window && !bounded && !stopped) {
    setCoverage(accountId, { since: windowStart(window), done: true });
  } else if (first && !window) store.setSyncState(accountId, { fullSyncDone: true });
  await ctx.newMail(newMail);
}

export const needsDeliveredTo = (accountId: string): boolean =>
  store.getKv(deliveredToKey(accountId)) !== "1";

/** For mail cached before summaries fetched DELIVERY_HEADERS; in the backfill lane, behind sync. */
export async function backfillDeliveredTo(accountId: string, ctx: SyncContext): Promise<void> {
  for (const [path, folderState] of Object.entries(readState(accountId))) {
    const cached = cachedUids(accountId, folderState.uidValidity, path);
    const uids = [...cached.keys()];
    for (let start = 0; start < uids.length; start += PAGE) {
      let fetched: FetchedMessage[];
      try {
        fetched = await inFolder(
          accountId,
          path,
          (client) => client.fetch(uids.slice(start, start + PAGE), { headers: DELIVERY_HEADERS }),
          { uidValidity: folderState.uidValidity },
        );
      } catch (err) {
        // Gone or recreated: the next sync refetches it. A folder the server won't read this
        // way keeps To and Cc to go by, rather than holding up body downloads.
        if (err instanceof FolderGone || err instanceof FolderChanged) break;
        if (err instanceof ImapError && (err.status === "NO" || err.status === "BAD")) break;
        throw err;
      }
      ctx.assertActive();
      store.setDeliveredTo(
        accountId,
        fetched.flatMap((message) => {
          const id = cached.get(message.uid);
          return id ? [{ id, deliveredTo: deliveryAddressesOf(message.headers) }] : [];
        }),
      );
    }
  }
  store.setKv(deliveredToKey(accountId), "1");
  ctx.bumpRevision();
  logger.info("imap-sync", "read the delivery headers of the mail cached before");
}

function labelsOf(folders: Folders, statuses: Map<string, MailboxStatus>): MailLabel[] {
  const labels: MailLabel[] = [];
  for (const folder of folders.synced) {
    if (!folder.labelId) continue;
    const status = statuses.get(folder.path);
    labels.push({
      id: folder.labelId,
      name: folder.role ? folder.labelId : folder.name,
      type: folder.role ? "system" : "user",
      unread: status?.unseen ?? undefined,
      total: status?.messages ?? undefined,
    });
  }
  labels.push({ id: "STARRED", name: "STARRED", type: "system" });
  labels.push({ id: "UNREAD", name: "UNREAD", type: "system" });
  return labels;
}

function writeLabels(accountId: string, labels: MailLabel[]): boolean {
  const before = store.getLabels(accountId);
  store.upsertLabels(accountId, labels);
  store.recountLabels(accountId, ["STARRED", "UNREAD"]);
  const key = (list: MailLabel[]) =>
    JSON.stringify(
      list
        .map((l) => [l.id, l.name, l.unread, l.total])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  return key(before) !== key(store.getLabels(accountId));
}

function readFolders(accountId: string) {
  return withImap(accountId, async (client) => {
    if (client.mailbox) await client.noop();
    const folders = await listFolders(accountId, client);
    const statuses = new Map<string, MailboxStatus>();
    for (const folder of folders.synced) {
      const status = await client.status(folder.path).catch(() => null);
      if (status) statuses.set(folder.path, status);
    }
    return { folders, statuses };
  });
}

export async function readLabels(accountId: string): Promise<MailLabel[]> {
  const { folders, statuses } = await readFolders(accountId);
  return labelsOf(folders, statuses);
}

const isDeleted = (message: FetchedMessage) =>
  message.flags?.some((flag) => flag.toLowerCase() === "\\deleted") ?? false;

function cachedUids(accountId: string, uidValidity: number, path: string): Map<number, string> {
  const uids = new Map<number, string>();
  for (const id of store.getMessageIdsWithPrefix(accountId, `${uidValidity}:`)) {
    const ref = parseMessageId(id);
    if (ref.path === path) uids.set(ref.uid, id);
  }
  return uids;
}

function dropFolder(accountId: string, path: string, uidValidity: number): void {
  const ids = [...cachedUids(accountId, uidValidity, path).values()];
  store.applyHistoryChanges(
    accountId,
    ids.map((id) => ({ kind: "deleted", id })),
  );
  if (ids.length > 0) logger.info("imap-sync", `dropped ${ids.length} cached messages of ${path}`);
}

/**
 * A folder whose label changed (the Archive, which had none before ARCHIVE)
 * moves its cached mail to the new label; answers whether it did.
 */
function relabelFolder(accountId: string, folder: Folder, state: FolderState | undefined): boolean {
  if (!state) return false;
  // Synced before folders kept their label: only the Archive's has changed since.
  const had =
    state.label !== undefined ? state.label : folder.role === "ARCHIVE" ? null : folder.labelId;
  state.label = folder.labelId;
  if (had === folder.labelId) return false;
  const ids = [...cachedUids(accountId, state.uidValidity, folder.path).values()];
  store.applyHistoryChanges(
    accountId,
    ids.flatMap((id) => [
      ...(had ? [{ kind: "labelsRemoved" as const, id, labelIds: [had] }] : []),
      ...(folder.labelId ? [{ kind: "labelsAdded" as const, id, labelIds: [folder.labelId] }] : []),
    ]),
  );
  return true;
}

/**
 * A folder renamed here: its cached mail and sync state follow when the
 * server kept its UIDVALIDITY; otherwise the next sync fetches it anew.
 */
export function renameFolderState(
  accountId: string,
  from: string,
  to: string,
  uidValidity: number,
): void {
  const state = readState(accountId);
  const folderState = state[from];
  if (!folderState) return;
  delete state[from];
  if (folderState.uidValidity === uidValidity) {
    for (const [uid, id] of cachedUids(accountId, uidValidity, from)) {
      const labels = store.getMessageLabelIds(accountId, id) ?? [];
      store.renameMessage(
        accountId,
        id,
        messageId(uidValidity, uid, to),
        labels.map((l) => (l === from ? to : l)),
      );
    }
    if (folderState.label === from) folderState.label = to;
    state[to] = folderState;
  } else {
    dropFolder(accountId, from, folderState.uidValidity);
  }
  writeState(accountId, state);
}

class FolderSync {
  /** The app went behind during the first sync: it goes on from `below` in front. */
  stopped = false;

  constructor(
    private readonly accountId: string,
    private readonly folder: Folder,
    private readonly ctx: SyncContext,
    public state: FolderState | undefined,
    private readonly window: CoverageWindow | null = null,
    private readonly bounded = false,
  ) {}

  async sync(status: MailboxStatus | undefined): Promise<MessageSummary[]> {
    const prev = this.state;
    const windowed = this.window !== null;
    if (filled(prev, windowed) && status && this.unchanged(prev, status)) return [];

    const { path } = this.folder;
    const complete = filled(prev, windowed);
    const qresync =
      complete && prev.modseq
        ? { uidValidity: prev.uidValidity, modseq: BigInt(prev.modseq) }
        : undefined;
    const opened = await withImap(this.accountId, async (client) => {
      const mailbox = await client.select(path, { qresync }).catch((err: unknown) => {
        throw err instanceof ImapError && err.status === "NO" ? new FolderGone(path) : err;
      });
      return {
        mailbox,
        qresynced:
          !!qresync && client.enabled.has("QRESYNC") && mailbox.uidValidity === qresync.uidValidity,
      };
    });
    const { mailbox } = opened;
    const seen = { messages: status?.messages, unseen: status?.unseen, checkedAt: Date.now() };

    if (prev && prev.uidValidity !== mailbox.uidValidity) {
      logger.info("imap-sync", `${path} has a new UIDVALIDITY; syncing it again`);
      this.ctx.assertActive();
      dropFolder(this.accountId, path, prev.uidValidity);
      this.ctx.bumpRevision();
      this.state = undefined;
    }

    if (!filled(this.state, windowed)) {
      this.state ??= {
        uidValidity: mailbox.uidValidity,
        uidNext: mailbox.uidNext ?? 1,
        modseq: mailbox.highestModseq?.toString(),
        below: mailbox.uidNext ?? Number.MAX_SAFE_INTEGER,
        label: this.folder.labelId,
      };
      await this.firstSync();
      Object.assign(this.state, seen);
      return [];
    }

    const added = await this.catchUp(this.state, mailbox, opened.qresynced);
    Object.assign(this.state, seen);
    return added;
  }

  private unchanged(prev: FolderState, status: MailboxStatus): boolean {
    if (status.uidValidity !== prev.uidValidity || status.uidNext !== prev.uidNext) return false;
    if (status.messages !== prev.messages) return false;
    if (status.highestModseq !== null) return prev.modseq === String(status.highestModseq);
    return status.unseen === prev.unseen && Date.now() - (prev.checkedAt ?? 0) < FLAG_CHECK_MS;
  }

  private run<T>(fn: (client: ImapClient, mailbox: SelectedMailbox) => Promise<T>): Promise<T> {
    return inFolder(this.accountId, this.folder.path, fn, { uidValidity: this.state!.uidValidity });
  }

  private async fetchAndStore(uids: number[]): Promise<MessageSummary[]> {
    const stored: MessageSummary[] = [];
    for (let end = uids.length; end > 0; end -= PAGE) {
      for (const summary of await this.fetchPage(uids.slice(Math.max(0, end - PAGE), end))) {
        stored.push(summary);
      }
    }
    return stored;
  }

  private async fetchPage(uids: number[]): Promise<MessageSummary[]> {
    const fetched = await this.run((client) => client.fetch(uids, SUMMARY_QUERY));
    const summaries: MessageSummary[] = [];
    for (const message of fetched) {
      if (isDeleted(message)) continue;
      summaries.push(await toSummary(this.folder, this.state!.uidValidity, message));
    }
    this.ctx.assertActive();
    store.upsertMessages(this.accountId, summaries);
    this.ctx.bumpRevision();
    return summaries;
  }

  private async firstSync(): Promise<void> {
    const state = this.state!;
    const top = state.below === Number.MAX_SAFE_INTEGER ? "*" : String(state.below - 1);
    // A window's fill started over (dropStaleCoverage) skips what's still cached.
    const known = this.window
      ? cachedUids(this.accountId, state.uidValidity, this.folder.path)
      : null;
    let uids =
      state.below > 1
        ? (
            await this.run((client) =>
              client.search({ uids: `1:${top}`, deleted: false, gmailRaw: this.folder.gmailRaw }),
            )
          ).filter((uid) => uid < state.below && !known?.has(uid))
        : [];
    let older: number[] = [];
    if (this.window) {
      const since = new Date(windowStart(this.window));
      const recent = await this.run((client) =>
        client.search({ uids: `1:${top}`, deleted: false, since, gmailRaw: this.folder.gmailRaw }),
      );
      const start = recent[0] ?? Infinity;
      older = uids.filter((uid) => uid < start);
      uids = uids.filter((uid) => uid >= start);
    }
    await this.fillDown(uids);
    if (this.stopped) return;
    // The floor is the inbox's: other folders fill separately, to the window alone.
    if (this.folder.role === "INBOX" && this.window) {
      for (;;) {
        const short = this.window.minThreads - store.countThreadsForLabel(this.accountId, "INBOX");
        if (short <= 0 || older.length === 0) break;
        await this.fillDown(older.splice(Math.max(0, older.length - Math.min(short, PAGE))));
        if (this.stopped) return;
      }
    }
    if (this.window) state.covered = true;
    else state.below = 0;
  }

  /** Caches `uids` newest first, a page at a time, keeping `below` as it goes. */
  private async fillDown(uids: number[]): Promise<void> {
    const state = this.state!;
    let synced = store.countAllMessages(this.accountId);
    for (let end = uids.length; end > 0; end -= PAGE) {
      if (inBackground()) {
        this.stopped = true;
        return;
      }
      const page = uids.slice(Math.max(0, end - PAGE), end);
      synced += (await this.fetchPage(page)).length;
      this.ctx.update({ synced });
      state.below = page[0]!;
      this.saveCursor();
    }
  }

  private saveCursor(): void {
    const all = readState(this.accountId);
    all[this.folder.path] = this.state!;
    writeState(this.accountId, all);
  }

  private async catchUp(
    state: FolderState,
    mailbox: {
      uidNext: number | null;
      highestModseq: bigint | null;
      vanished: UidRange[];
      changed: FetchedMessage[];
    },
    qresynced: boolean,
  ): Promise<MessageSummary[]> {
    const { accountId, folder } = this;
    const since = state.modseq !== undefined ? BigInt(state.modseq) : null;

    const known = cachedUids(accountId, state.uidValidity, folder.path);
    let flags: FetchedMessage[] = [];
    let listing: number[] | null = null;
    if (qresynced) {
      flags = mailbox.changed;
    } else if (since !== null && mailbox.highestModseq !== null) {
      if (mailbox.highestModseq !== since) {
        flags = await this.run((client) =>
          client.fetch("1:*", { flags: true }, { changedSince: since }),
        );
      }
    } else if (this.window) {
      // Only what's cached: the folder's older mail was never read.
      if (known.size > 0 && !hasPendingLabelWrites(accountId)) {
        flags = await this.run((client) => client.fetch([...known.keys()], { flags: true }));
      }
    } else if (!hasPendingLabelWrites(accountId)) {
      flags = await this.run((client) => client.fetch("1:*", { flags: true }));
      if (!folder.gmailRaw) listing = flags.filter((m) => !isDeleted(m)).map((m) => m.uid);
    }
    const ops: store.HistoryOp[] = [];
    for (const message of flags) {
      const id = known.get(message.uid);
      if (!id || message.uid >= state.uidNext) continue;
      if (isDeleted(message)) {
        ops.push({ kind: "deleted", id });
        known.delete(message.uid);
        continue;
      }
      const want = labelsFor(folder, message.flags ?? []).filter((l) => FLAG_LABELS.includes(l));
      const have = store.getMessageLabelIds(accountId, id) ?? [];
      const add = want.filter((l) => !have.includes(l));
      const remove = FLAG_LABELS.filter((l) => have.includes(l) && !want.includes(l));
      if (add.length) ops.push({ kind: "labelsAdded", id, labelIds: add });
      if (remove.length) ops.push({ kind: "labelsRemoved", id, labelIds: remove });
    }
    // Ranges may span every UID there could be: checked against the cache, never expanded.
    if (mailbox.vanished.length > 0) {
      const vanished = inUidRanges(mailbox.vanished);
      for (const [uid, id] of known) {
        if (!vanished(uid)) continue;
        ops.push({ kind: "deleted", id });
        known.delete(uid);
      }
    }

    let fresh: number[] = [];
    if (mailbox.uidNext === null || mailbox.uidNext > state.uidNext) {
      fresh = (
        await this.run((client) =>
          client.search({ uids: `${state.uidNext}:*`, gmailRaw: this.folder.gmailRaw }),
        )
      ).filter((uid) => uid >= state.uidNext);
    }
    if (this.bounded && fresh.length > BACKGROUND_MAX_MESSAGES) throw new Deferred();

    const missing: number[] = [];
    const count = await this.run(async (_client, box) => box.exists);
    if (listing || known.size + fresh.length !== count) {
      const onServer = new Set(
        listing ??
          (await this.run((client) =>
            client.search({ deleted: false, gmailRaw: this.folder.gmailRaw }),
          )),
      );
      for (const [uid, id] of known) {
        if (!onServer.has(uid)) ops.push({ kind: "deleted", id });
      }
      const fresher = new Set(fresh);
      // With a window, what isn't cached is older mail left on the server.
      for (const uid of this.window ? [] : onServer) {
        if (!known.has(uid) && !fresher.has(uid)) missing.push(uid);
      }
    }

    this.ctx.assertActive();
    if (ops.length > 0) {
      store.applyHistoryChanges(accountId, ops);
      this.ctx.bumpRevision();
    }
    if (missing.length > 0) {
      logger.info(
        "imap-sync",
        `${folder.path}: fetching ${missing.length} messages the cache missed`,
      );
      await this.fetchAndStore(missing);
    }
    const added = fresh.length > 0 ? await this.fetchAndStore(fresh) : [];
    if (added.length > 0) {
      store.recountLabels(accountId, [...new Set(added.flatMap((m) => m.labelIds))]);
    }

    let uidNext = Math.max(mailbox.uidNext ?? 0, state.uidNext);
    for (const uid of fresh) uidNext = Math.max(uidNext, uid + 1);
    state.uidNext = uidNext;
    if (mailbox.highestModseq !== null) state.modseq = mailbox.highestModseq.toString();
    return added;
  }
}
