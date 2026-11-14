/**
 * Changing mail on the server. Read and starred are flags (\Seen,
 * \Flagged); every other label is a folder, so applying one moves the
 * message there (one folder per message: `capabilities.multipleLabels` is
 * false). The cache already shows the change (the handlers mirror it first);
 * here the server catches up, and moved messages get their new ids.
 *
 * Conversations follow Gmail's rules as far as folders allow: archiving
 * takes what's in the Inbox (your replies stay in Sent), moving to a folder
 * takes the received mail, trashing takes everything.
 */

import { ARCHIVE_LABEL_ID } from "@otter/contracts";

import { getAccount } from "../../services/account-store.js";
import * as store from "../../services/mail-store.js";
import type { ImapClient } from "../../protocols/index.js";
import type { MailLabel, MessageSummary } from "../../types.js";
import type { LabelChange } from "../provider.js";
import { findByMessageId, FolderGone, selectFolder, withImap } from "./connection.js";
import {
  byFolder,
  ensureFolder,
  FLAG_LABELS,
  foldersOf,
  isSystemLabel,
  listFolders,
  messageId,
  parseMessageId,
  type Folder,
  type Folders,
  type Role,
} from "./folders.js";
import { currentId, getSummaries, rememberMove } from "./reads.js";
import { renameFolderState } from "./sync.js";

type Row = { id: string; labelIds: string[]; fromEmail?: string };

/**
 * Where trashed mail came from, for putting it back: its id in Trash → folder
 * path. Kept in kv, so it outlives a restart.
 */
const trashedKey = (accountId: string) => `imapTrashedFrom:${accountId}`;

function trashedFrom(accountId: string): Record<string, string> {
  return JSON.parse(store.getKv(trashedKey(accountId)) ?? "{}") as Record<string, string>;
}

function editTrashedFrom(accountId: string, edit: (origins: Record<string, string>) => void) {
  const origins = trashedFrom(accountId);
  const before = JSON.stringify(origins);
  edit(origins);
  const after = JSON.stringify(origins);
  if (after !== before) store.setKv(trashedKey(accountId), after);
}

const rowOf = (accountId: string, id: string): Row => {
  const current = currentId(id);
  return { id: current, labelIds: store.getMessageLabelIds(accountId, current) ?? [] };
};

const threadRows = (accountId: string, threadId: string): Row[] =>
  store.getThreadMessages(accountId, threadId);

/** Removes \Deleted messages: only `uids` (UID EXPUNGE); without UIDPLUS, only when nothing else is marked. */
export async function expungeOnly(client: ImapClient, uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  if (client.has("UIDPLUS")) return client.expunge(uids);
  const marked = await client.search({ deleted: true });
  // Someone else's \Deleted mail would go too: ours stays marked (sync hides it) until theirs goes.
  if (marked.every((uid) => uids.includes(uid))) await client.expunge();
}

/**
 * UID MOVE, or COPY + \Deleted + a careful expunge. Out of Gmail's All Mail,
 * only a copy: there, the message is everywhere it has a label, and taking it
 * out of All Mail would delete it.
 */
async function moveUids(client: ImapClient, uids: number[], destination: string, allMail = false) {
  if (allMail) return client.copy(uids, destination);
  if (client.has("MOVE")) return client.move(uids, destination);
  const copied = await client.copy(uids, destination);
  await client.store(uids, { add: ["\\Deleted"] });
  await expungeOnly(client, uids);
  return copied;
}

/**
 * Moves messages to their destinations (id → folder), then re-keys their
 * cached rows. Where the server doesn't say the new UID (no UIDPLUS), it's
 * found by Message-ID; failing that, the row goes and sync brings it back.
 * Answers old id → new id.
 */
async function moveMessages(
  accountId: string,
  client: ImapClient,
  folders: Folders,
  moves: Map<string, Folder>,
): Promise<Map<string, string>> {
  const moved = new Map<string, string>();
  const lost: { from: string; dest: Folder }[] = [];
  const byDest = new Map<Folder, string[]>();
  for (const [id, dest] of moves) {
    if (parseMessageId(id).path === dest.path) continue;
    byDest.set(dest, [...(byDest.get(dest) ?? []), id]);
  }
  for (const [dest, ids] of byDest) {
    for (const [path, refs] of byFolder(ids)) {
      let mailbox;
      try {
        mailbox = await selectFolder(client, path);
      } catch (err) {
        if (err instanceof FolderGone) continue;
        throw err;
      }
      const live = refs.filter((r) => r.uidValidity === mailbox.uidValidity);
      if (live.length === 0) continue;
      const copied = await moveUids(
        client,
        live.map((r) => r.uid),
        dest.path,
        folders.isAllMail(path),
      );
      for (const ref of live) {
        const from = messageId(ref.uidValidity, ref.uid, path);
        const uid = copied?.uids.get(ref.uid);
        if (copied && uid !== undefined)
          moved.set(from, messageId(copied.uidValidity, uid, dest.path));
        else lost.push({ from, dest });
      }
    }
  }
  for (const { from, dest } of lost) {
    const header = store.getStoredReplyHeaders(accountId, from).messageIdHeader;
    const mailbox = await selectFolder(client, dest.path);
    const uids = header ? await findByMessageId(client, header) : [];
    if (uids.length > 0) moved.set(from, messageId(mailbox.uidValidity, uids.at(-1)!, dest.path));
    else store.deleteMessage(accountId, from);
  }
  for (const [from, to] of moved) {
    const labels = store.getMessageLabelIds(accountId, from) ?? [];
    const dest = folders.get(parseMessageId(to).path);
    store.renameMessage(accountId, from, to, rowLabels(dest, labels));
    rememberMove(from, to);
  }
  return moved;
}

function rowLabels(folder: Folder | undefined, labels: string[]): string[] {
  const flags = labels.filter((l) => FLAG_LABELS.includes(l) && l !== folder?.labelId);
  return folder?.labelId ? [folder.labelId, ...flags] : flags;
}

function settleRows(accountId: string, folders: Folders, rows: Row[], moved: Map<string, string>) {
  for (const row of rows) {
    if (moved.has(row.id)) continue;
    const current = store.getMessageLabelIds(accountId, row.id);
    if (!current) continue;
    const want = rowLabels(folders.get(parseMessageId(row.id).path), current);
    const add = want.filter((l) => !current.includes(l));
    const remove = current.filter((l) => !want.includes(l));
    if (add.length || remove.length) store.applyLabelChange(accountId, row.id, add, remove);
  }
}

async function setFlags(client: ImapClient, ids: string[], change: LabelChange): Promise<void> {
  const add: string[] = [];
  const remove: string[] = [];
  if (change.addLabelIds?.includes("UNREAD")) remove.push("\\Seen");
  if (change.removeLabelIds?.includes("UNREAD")) add.push("\\Seen");
  if (change.addLabelIds?.includes("STARRED")) add.push("\\Flagged");
  if (change.removeLabelIds?.includes("STARRED")) remove.push("\\Flagged");
  if (add.length === 0 && remove.length === 0) return;
  for (const [path, refs] of byFolder(ids)) {
    const mailbox = await selectFolder(client, path).catch((err: unknown) => {
      if (err instanceof FolderGone) return null;
      throw err;
    });
    const uids = refs.filter((r) => r.uidValidity === mailbox?.uidValidity).map((r) => r.uid);
    if (uids.length > 0) await client.store(uids, { add, remove });
  }
}

const roleOfRow = (folders: Folders, row: Row): Role | null =>
  folders.get(parseMessageId(row.id).path)?.role ?? null;

async function planMoves(
  accountId: string,
  client: ImapClient,
  folders: Folders,
  rows: Row[],
  change: LabelChange,
  thread: boolean,
): Promise<Map<string, Folder>> {
  const add = change.addLabelIds ?? [];
  const remove = change.removeLabelIds ?? [];
  const moves = new Map<string, Folder>();
  const isFolder = (l: string) =>
    l === "INBOX" ||
    l === "TRASH" ||
    l === "SPAM" ||
    l === ARCHIVE_LABEL_ID ||
    folders.get(l)?.role === null;
  const target = add.find(isFolder);

  if (target) {
    const dest =
      target === "TRASH"
        ? await ensureFolder(accountId, client, "TRASH", "Trash")
        : target === "SPAM"
          ? await ensureFolder(accountId, client, "SPAM", "Junk")
          : target === ARCHIVE_LABEL_ID
            ? await ensureFolder(accountId, client, "ARCHIVE", "Archive")
            : folders.forLabel(target);
    if (!dest) return moves;
    const kept = new Set<Role>(target === "TRASH" ? [] : ["SENT", "DRAFT", "TRASH", "SPAM"]);
    for (const label of remove) kept.delete(label as Role);
    const others = rows.filter((r) => parseMessageId(r.id).path !== dest.path);
    let movable = thread
      ? others.filter((r) => {
          const role = roleOfRow(folders, r);
          return !role || !kept.has(role);
        })
      : others;
    if (movable.length === 0 && thread) {
      movable = others.filter((r) => roleOfRow(folders, r) !== "DRAFT");
    }
    if (thread && (target === "SPAM" || remove.includes("SPAM"))) {
      const shown = movable.filter((r) => {
        const label = folders.get(parseMessageId(r.id).path)?.labelId;
        return !!label && remove.includes(label);
      });
      movable = shown.length > 0 ? shown : movable.slice(-1);
    }
    for (const row of movable) moves.set(row.id, dest);
    return moves;
  }

  const archived = remove.filter((l) => l === "INBOX" || folders.get(l)?.role === null);
  if (archived.length > 0) {
    const archive = await ensureFolder(accountId, client, "ARCHIVE", "Archive");
    for (const row of rows) {
      const label = folders.get(parseMessageId(row.id).path)?.labelId;
      if (label && archived.includes(label)) moves.set(row.id, archive);
    }
    return moves;
  }

  const putBack = (["SPAM", "TRASH", "ARCHIVE"] as const).filter((role) => remove.includes(role));
  if (putBack.length > 0) {
    const account = await getAccount(accountId);
    const origins = trashedFrom(accountId);
    for (const row of rows) {
      const role = roleOfRow(folders, row);
      if (!role || !(putBack as Role[]).includes(role)) continue;
      const origin = role === "TRASH" ? folders.get(origins[row.id] ?? "") : undefined;
      const own = row.fromEmail && row.fromEmail.toLowerCase() === account?.email.toLowerCase();
      const dest =
        origin ?? (own ? folders.withRole("SENT") : undefined) ?? folders.withRole("INBOX");
      if (dest) moves.set(row.id, dest);
    }
  }
  return moves;
}

async function changeLabels(
  accountId: string,
  rows: Row[],
  change: LabelChange,
  thread: boolean,
): Promise<Map<string, string>> {
  return withImap(accountId, async (client) => {
    const folders = await foldersOf(accountId, client);
    await setFlags(
      client,
      rows.map((r) => r.id),
      change,
    );
    const moves = await planMoves(accountId, client, folders, rows, change, thread);
    const moved = await moveMessages(accountId, client, await foldersOf(accountId, client), moves);
    settleRows(accountId, folders, rows, moved);
    editTrashedFrom(accountId, (origins) => {
      for (const [from, to] of moved) {
        const origin = origins[from] ?? parseMessageId(from).path;
        delete origins[from];
        if (change.addLabelIds?.includes("TRASH")) origins[to] = origin;
      }
    });
    return moved;
  });
}

export async function modifyMessage(accountId: string, id: string, change: LabelChange) {
  await changeLabels(accountId, [rowOf(accountId, id)], change, false);
}

export async function modifyThread(accountId: string, threadId: string, change: LabelChange) {
  await changeLabels(accountId, threadRows(accountId, threadId), change, true);
}

export async function trashMessage(accountId: string, id: string) {
  await changeLabels(accountId, [rowOf(accountId, id)], { addLabelIds: ["TRASH"] }, false);
}

export async function trashThread(accountId: string, threadId: string) {
  await changeLabels(accountId, threadRows(accountId, threadId), { addLabelIds: ["TRASH"] }, true);
}

async function untrash(accountId: string, rows: Row[]): Promise<MessageSummary[]> {
  const moved = await changeLabels(accountId, rows, { removeLabelIds: ["TRASH"] }, false);
  return getSummaries(accountId, [...moved.values()]);
}

export const untrashMessage = (accountId: string, id: string) =>
  untrash(accountId, [rowOf(accountId, id)]);

export const untrashThread = (accountId: string, threadId: string) =>
  untrash(accountId, threadRows(accountId, threadId));

export async function markRead(accountId: string, ids: string[]) {
  const rows = ids.map((id) => rowOf(accountId, id));
  await changeLabels(accountId, rows, { removeLabelIds: ["UNREAD"] }, false);
}

export async function deleteForever(accountId: string, ids: string[]): Promise<void> {
  await withImap(accountId, async (client) => {
    for (const [path, refs] of byFolder(ids.map(currentId))) {
      const mailbox = await selectFolder(client, path).catch((err: unknown) => {
        if (err instanceof FolderGone) return null;
        throw err;
      });
      const uids = refs.filter((r) => r.uidValidity === mailbox?.uidValidity).map((r) => r.uid);
      if (uids.length === 0) continue;
      await client.store(uids, { add: ["\\Deleted"] });
      await expungeOnly(client, uids);
    }
  });
  editTrashedFrom(accountId, (origins) => {
    for (const id of ids) delete origins[currentId(id)];
  });
}

export async function emptyFolder(
  accountId: string,
  labelId: "SPAM" | "TRASH",
  cachedIds: string[],
): Promise<string[]> {
  const ids = new Set(cachedIds);
  await withImap(accountId, async (client) => {
    const folder = (await foldersOf(accountId, client)).forLabel(labelId);
    if (!folder) return;
    const mailbox = await selectFolder(client, folder.path);
    const uids = await client.search("ALL");
    if (uids.length === 0) return;
    for (const uid of uids) ids.add(messageId(mailbox.uidValidity, uid, folder.path));
    await client.store("1:*", { add: ["\\Deleted"] });
    // Everything in the folder goes, so a plain EXPUNGE takes nothing else.
    await client.expunge();
  });
  if (labelId === "TRASH") store.setKv(trashedKey(accountId), "{}");
  return [...ids];
}

export async function createLabel(accountId: string, name: string): Promise<MailLabel> {
  return withImap(accountId, async (client) => {
    const path = (await listFolders(accountId, client)).pathFor(name);
    await client.createMailbox(path);
    const folder = (await listFolders(accountId, client)).get(path);
    return { id: path, name: folder?.name ?? name, type: "user", unread: 0, total: 0 };
  });
}

export async function updateLabel(
  accountId: string,
  params: { labelId: string; name?: string },
): Promise<void> {
  if (!params.name) return;
  const name = params.name;
  await withImap(accountId, async (client) => {
    const folders = await listFolders(accountId, client);
    const from = folders.get(params.labelId);
    if (isSystemLabel(params.labelId) || from?.role) {
      throw new Error("Only your own folders can be renamed.");
    }
    if (!from) throw new Error("That folder isn't on the server any more.");
    const to = folders.pathFor(name);
    if (to === from.path) return;
    await client.renameMailbox(from.path, to);
    await listFolders(accountId, client);
    const { uidValidity } = await client.status(to);
    if (uidValidity !== null) renameFolderState(accountId, from.path, to, uidValidity);
  });
}

export async function deleteLabel(accountId: string, labelId: string): Promise<void> {
  await withImap(accountId, async (client) => {
    const folders = await listFolders(accountId, client);
    const folder = folders.get(labelId);
    if (isSystemLabel(labelId) || folder?.role) {
      throw new Error("Only your own folders can be deleted.");
    }
    // Deleted or renamed elsewhere since the sidebar listed it: it's gone either way.
    if (!folder) return;
    const mailbox = await selectFolder(client, folder.path);
    const uids = await client.search("ALL");
    if (uids.length > 0) {
      const archive = await ensureFolder(accountId, client, "ARCHIVE", "Archive");
      const moves = new Map(
        uids.map((uid) => [messageId(mailbox.uidValidity, uid, folder.path), archive]),
      );
      await moveMessages(accountId, client, await foldersOf(accountId, client), moves);
    }
    // Some servers won't delete the folder that's open.
    await client.select("INBOX");
    await client.deleteMailbox(folder.path);
    await listFolders(accountId, client);
  });
}
