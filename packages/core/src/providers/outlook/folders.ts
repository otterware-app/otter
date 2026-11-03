import { ARCHIVE_LABEL_ID, SNOOZED_LABEL_ID } from "@otter-mail/contracts";

import * as store from "../../services/mail-store.js";
import type { MailLabel } from "../../types.js";
import { graph, graphAll, graphBatch, isAccessDenied, ok } from "./graph.js";

export const FOLDER_PREFIX = "folder:";
export const CATEGORY_PREFIX = "category:";

const WELL_KNOWN = [
  "inbox",
  "sentitems",
  "drafts",
  "deleteditems",
  "junkemail",
  "archive",
  "outbox",
  "conversationhistory",
  "syncissues",
  "scheduled",
  "recoverableitemsdeletions",
  "recoverableitemspurges",
  "recoverableitemsversions",
] as const;
type WellKnown = (typeof WELL_KNOWN)[number];

const SYSTEM_LABEL: Partial<Record<WellKnown, string>> = {
  inbox: "INBOX",
  sentitems: "SENT",
  drafts: "DRAFT",
  deleteditems: "TRASH",
  junkemail: "SPAM",
  archive: ARCHIVE_LABEL_ID,
  scheduled: SNOOZED_LABEL_ID,
};

const RECOVERABLE: WellKnown[] = [
  "recoverableitemsdeletions",
  "recoverableitemspurges",
  "recoverableitemsversions",
];

// Deleted mail Graph can still read: a message found there was deleted, not moved.
const SKIPPED: WellKnown[] = ["outbox", "conversationhistory", "syncissues", ...RECOVERABLE];

export const FLAG_LABELS = ["UNREAD", "STARRED", "IMPORTANT"];

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  unread: number;
  total: number;
  labelId: string | null;
}

export interface Category {
  name: string;
  color: string;
}

export interface Mailbox {
  wellKnown: Partial<Record<WellKnown, string>>;
  folders: Folder[];
  categories: Category[];
}

const mailboxes = new Map<string, Mailbox>();
const key = (accountId: string) => `outlookMailbox:${accountId}`;

export function mailboxOf(accountId: string): Mailbox | null {
  let mailbox = mailboxes.get(accountId) ?? null;
  if (!mailbox) {
    const saved = store.getKv(key(accountId));
    if (saved) {
      try {
        mailbox = JSON.parse(saved) as Mailbox;
        mailboxes.set(accountId, mailbox);
      } catch {
        // read again
      }
    }
  }
  return mailbox;
}

export function forgetFolders(accountId: string): void {
  mailboxes.delete(accountId);
}

type ApiFolder = {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
};

const FOLDER_FIELDS =
  "id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount";

/**
 * A folder's subfolders as last listed, standing in for a listing Outlook
 * refused: their mail isn't taken for deleted, their labels and paths follow
 * the parent, and their counts are the cache's, which sync keeps current
 * (one in Trash or Junk shares the label's count, so it adds none).
 */
function lastListed(accountId: string, mailbox: Mailbox | null, parent: string): ApiFolder[] {
  const parentName = mailbox?.folders.find((f) => f.id === parent)?.name;
  return (mailbox?.folders ?? [])
    .filter((f) => f.parentId === parent)
    .map((f) => {
      const own = f.labelId?.startsWith(FOLDER_PREFIX);
      return {
        id: f.id,
        displayName:
          parentName && f.name.startsWith(`${parentName}/`)
            ? f.name.slice(parentName.length + 1)
            : f.name,
        childFolderCount: mailbox!.folders.filter((c) => c.parentId === f.id).length,
        unreadItemCount: own ? store.countUnreadForLabel(accountId, f.labelId!) : 0,
        totalItemCount: own ? store.countMessagesForLabel(accountId, f.labelId!) : 0,
      };
    });
}

const recoverableRetry = new Map<string, number>();

export async function readMailbox(accountId: string): Promise<Mailbox> {
  const previous = mailboxOf(accountId);
  const known = previous?.wellKnown;
  const wellKnown: Mailbox["wellKnown"] = {};
  if (known?.inbox) {
    Object.assign(wellKnown, known);
    // A mailbox without an Archive gets one when mail is first archived (by Outlook too).
    if (!known.archive) {
      const archive = await graph<{ id?: string }>(
        accountId,
        "/me/mailFolders/archive?$select=id",
      ).catch(() => null);
      if (archive?.id) wellKnown.archive = archive.id;
    }
    const missing = RECOVERABLE.filter((name) => !known[name]);
    if (missing.length > 0 && Date.now() >= (recoverableRetry.get(accountId) ?? 0)) {
      recoverableRetry.set(accountId, Date.now() + 60 * 60_000);
      const answers = await graphBatch(
        accountId,
        missing.map((name) => ({ method: "GET", url: `/me/mailFolders/${name}?$select=id` })),
      ).catch(() => []);
      missing.forEach((name, i) => {
        const id = ok(answers[i]) ? (answers[i]!.body as { id?: string }).id : undefined;
        if (id) wellKnown[name] = id;
      });
    }
  } else {
    const answers = await graphBatch(
      accountId,
      WELL_KNOWN.map((name) => ({ method: "GET", url: `/me/mailFolders/${name}?$select=id` })),
    );
    WELL_KNOWN.forEach((name, i) => {
      const id = ok(answers[i]) ? (answers[i]!.body as { id?: string }).id : undefined;
      if (id) wellKnown[name] = id;
    });
    if (!wellKnown.inbox) throw new Error("Outlook didn't say where this mailbox's inbox is.");
  }

  const roleOf = new Map<string, WellKnown>();
  for (const [name, id] of Object.entries(wellKnown)) roleOf.set(id, name as WellKnown);

  const folders: Folder[] = [];
  const visit = async (parent: string | null, parentPath: string, inherited: string | null) => {
    let children: ApiFolder[];
    try {
      children = await graphAll<ApiFolder>(
        accountId,
        parent
          ? `/me/mailFolders/${parent}/childFolders?$top=100&$select=${FOLDER_FIELDS}`
          : `/me/mailFolders?$top=100&$select=${FOLDER_FIELDS}`,
      );
    } catch (err) {
      if (!parent || !isAccessDenied(err)) throw err;
      children = lastListed(accountId, previous, parent);
    }
    for (const child of children) {
      const role = roleOf.get(child.id);
      if (role && SKIPPED.includes(role)) continue;
      const path = parentPath ? `${parentPath}/${child.displayName}` : child.displayName;
      const labelId =
        inherited ?? (role ? (SYSTEM_LABEL[role] ?? null) : `${FOLDER_PREFIX}${child.id}`);
      folders.push({
        id: child.id,
        name: path,
        parentId: parent,
        unread: child.unreadItemCount ?? 0,
        total: child.totalItemCount ?? 0,
        labelId,
      });
      if ((child.childFolderCount ?? 0) > 0) {
        const keep = labelId === "TRASH" || labelId === "SPAM" ? labelId : null;
        await visit(child.id, path, keep);
      }
    }
  };
  await visit(null, "", null);
  const order = (f: Folder) =>
    f.id === wellKnown.inbox ? 0 : f.labelId === "SPAM" ? 2 : f.labelId === "TRASH" ? 3 : 1;
  folders.sort((a, b) => order(a) - order(b));

  const categories =
    (
      await graph<{ value?: { displayName: string; color?: string }[] }>(
        accountId,
        "/me/outlook/masterCategories",
      ).catch(() => ({ value: [] }))
    ).value?.map((c) => ({ name: c.displayName, color: c.color ?? "none" })) ?? [];

  const mailbox: Mailbox = { wellKnown, folders, categories };
  mailboxes.set(accountId, mailbox);
  store.setKv(key(accountId), JSON.stringify(mailbox));
  return mailbox;
}

export async function ensureMailbox(accountId: string): Promise<Mailbox> {
  return mailboxOf(accountId) ?? readMailbox(accountId);
}

export function folderById(accountId: string, id: string): Folder | undefined {
  return mailboxOf(accountId)?.folders.find((f) => f.id === id);
}

export async function wellKnownId(accountId: string, name: WellKnown): Promise<string> {
  const id = (await ensureMailbox(accountId)).wellKnown[name];
  // Mailboxes without an Archive folder yet: Graph makes it on first use.
  return id ?? name;
}

export function folderLabel(accountId: string, folderId: string | undefined): string | null {
  if (!folderId) return null;
  const mailbox = mailboxOf(accountId);
  const folder = mailbox?.folders.find((f) => f.id === folderId);
  if (folder) return folder.labelId;
  const role = Object.entries(mailbox?.wellKnown ?? {}).find(([, id]) => id === folderId)?.[0];
  if (role) return SYSTEM_LABEL[role as WellKnown] ?? null;
  return `${FOLDER_PREFIX}${folderId}`;
}

export function isSyncedFolder(accountId: string, folderId: string | undefined): boolean {
  const mailbox = mailboxOf(accountId);
  if (!folderId || !mailbox) return true;
  return !SKIPPED.some((name) => mailbox.wellKnown[name] === folderId);
}

export async function folderOfLabel(accountId: string, labelId: string): Promise<string | null> {
  if (labelId.startsWith(FOLDER_PREFIX)) return labelId.slice(FOLDER_PREFIX.length);
  const role = (Object.entries(SYSTEM_LABEL) as [WellKnown, string][]).find(
    ([, label]) => label === labelId,
  )?.[0];
  return role ? wellKnownId(accountId, role) : null;
}

export const categoryLabel = (name: string) => `${CATEGORY_PREFIX}${name}`;
export const categoryOf = (labelId: string): string | null =>
  labelId.startsWith(CATEGORY_PREFIX) ? labelId.slice(CATEGORY_PREFIX.length) : null;

const PRESETS: Record<string, string> = {
  preset0: "#e74856",
  preset1: "#ff8c00",
  preset2: "#ab7b5d",
  preset3: "#fff100",
  preset4: "#47d041",
  preset5: "#30c6cc",
  preset6: "#73aa24",
  preset7: "#4cb4ff",
  preset8: "#8764b8",
  preset9: "#f495bf",
  preset10: "#4b7a9e",
  preset11: "#2d4250",
  preset12: "#a0aeb2",
  preset13: "#6b7b81",
  preset14: "#1f1f1f",
  preset15: "#a4262c",
  preset16: "#ca5010",
  preset17: "#8e562e",
  preset18: "#c19c00",
  preset19: "#0b6a0b",
  preset20: "#038387",
  preset21: "#5c7e10",
  preset22: "#004e8c",
  preset23: "#5c2e91",
  preset24: "#9b1c54",
};

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function textOn(hex: string): string {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1f1f1f" : "#ffffff";
}

export function presetColor(
  preset: string,
): { backgroundColor: string; textColor: string } | undefined {
  const hex = PRESETS[preset];
  return hex ? { backgroundColor: hex, textColor: textOn(hex) } : undefined;
}

export function nearestPreset(hex: string): string {
  const [r, g, b] = rgb(hex);
  let best = "preset7";
  let bestDistance = Infinity;
  for (const [preset, value] of Object.entries(PRESETS)) {
    const [r2, g2, b2] = rgb(value);
    const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [preset, distance];
  }
  return best;
}

export function labelsOf(accountId: string, mailbox: Mailbox): MailLabel[] {
  const labels: MailLabel[] = [];
  const seen = new Set<string>();
  for (const folder of mailbox.folders) {
    if (!folder.labelId) continue;
    const system = !folder.labelId.startsWith(FOLDER_PREFIX);
    const existing = labels.find((l) => l.id === folder.labelId);
    if (existing) {
      existing.unread = (existing.unread ?? 0) + folder.unread;
      existing.total = (existing.total ?? 0) + folder.total;
      continue;
    }
    seen.add(folder.labelId);
    labels.push({
      id: folder.labelId,
      name: system ? folder.labelId : folder.name,
      type: system ? "system" : "user",
      unread: folder.unread,
      total: folder.total,
    });
  }
  const local = (id: string) => ({
    unread: store.countUnreadForLabel(accountId, id),
    total: store.countMessagesForLabel(accountId, id),
  });
  for (const id of FLAG_LABELS) {
    labels.push({ id, name: id, type: "system", ...local(id) });
  }
  for (const category of mailbox.categories) {
    const id = categoryLabel(category.name);
    if (seen.has(id)) continue;
    seen.add(id);
    labels.push({
      id,
      name: category.name,
      type: "user",
      ...local(id),
      color: presetColor(category.color),
    });
  }
  return labels;
}

export function labelsFor(
  accountId: string,
  message: {
    parentFolderId?: string;
    isRead?: boolean;
    flag?: { flagStatus?: string } | null;
    importance?: string;
    categories?: string[];
  },
): string[] {
  const labels: string[] = [];
  const folder = folderLabel(accountId, message.parentFolderId);
  if (folder) labels.push(folder);
  if (message.isRead === false) labels.push("UNREAD");
  if (message.flag?.flagStatus === "flagged") labels.push("STARRED");
  if (message.importance === "high") labels.push("IMPORTANT");
  for (const category of message.categories ?? []) labels.push(categoryLabel(category));
  return labels;
}

export function skippedFolderIds(accountId: string): string[] {
  const mailbox = mailboxOf(accountId);
  return SKIPPED.flatMap((name) => mailbox?.wellKnown[name] ?? []);
}
