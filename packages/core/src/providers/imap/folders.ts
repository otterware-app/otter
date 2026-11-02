import { ARCHIVE_LABEL_ID } from "@otter-mail/contracts";

import type { ImapClient, ImapFolder, SpecialUse } from "../../protocols/index.js";

export type Role = "INBOX" | "SENT" | "DRAFT" | "TRASH" | "SPAM" | "ARCHIVE";

export interface Folder {
  path: string;
  delimiter: string | null;
  role: Role | null;
  labelId: string | null;
  name: string;
  gmailRaw?: string;
}

/** Gmail's archived mail: in All Mail and nowhere else (no inbox, no label, not Sent or Drafts). */
const GMAIL_ARCHIVED = "-in:inbox -in:sent -in:drafts -in:chats has:nouserlabels";

const SPECIAL_USE_ROLES: Partial<Record<SpecialUse, Role>> = {
  "\\Sent": "SENT",
  "\\Drafts": "DRAFT",
  "\\Trash": "TRASH",
  "\\Junk": "SPAM",
  "\\Archive": "ARCHIVE",
};

/** Folder names servers use for the special folders when they don't flag them. */
const ROLE_NAMES: Record<Exclude<Role, "INBOX">, string[]> = {
  SENT: [
    "sent",
    "sent items",
    "sent messages",
    "sent mail",
    "gesendet",
    "gesendete elemente",
    "envoyés",
    "éléments envoyés",
    "enviados",
    "posta inviata",
    "inviata",
    "verzonden",
  ],
  DRAFT: ["drafts", "draft", "entwürfe", "brouillons", "borradores", "bozze", "concepten"],
  TRASH: [
    "trash",
    "deleted items",
    "deleted messages",
    "bin",
    "papierkorb",
    "corbeille",
    "papelera",
    "cestino",
    "prullenbak",
  ],
  SPAM: ["junk", "spam", "junk e-mail", "junk email", "bulk mail", "courrier indésirable"],
  ARCHIVE: ["archive", "archives", "archiv", "archivo", "archivio", "archief"],
};

const SYSTEM_LABELS: Record<Role, string> = {
  INBOX: "INBOX",
  SENT: "SENT",
  DRAFT: "DRAFT",
  TRASH: "TRASH",
  SPAM: "SPAM",
  ARCHIVE: ARCHIVE_LABEL_ID,
};

export const FLAG_LABELS = ["UNREAD", "STARRED", "DRAFT"];

export class Folders {
  readonly synced: Folder[];
  readonly archive: Folder | undefined;
  private readonly allMail: string | undefined;
  private readonly byPath = new Map<string, Folder>();

  constructor(list: ImapFolder[], gmail = false) {
    const usable = list.filter(
      (f) =>
        f.selectable &&
        f.specialUse !== "\\All" &&
        f.specialUse !== "\\Flagged" &&
        f.specialUse !== "\\Important",
    );
    const roles = new Map<Role, string>([["INBOX", "INBOX"]]);
    for (const f of usable) {
      const role = f.specialUse ? SPECIAL_USE_ROLES[f.specialUse] : undefined;
      if (role && !roles.has(role)) roles.set(role, f.path);
    }
    for (const [role, names] of Object.entries(ROLE_NAMES) as [Role, string[]][]) {
      if (roles.has(role) || (gmail && role === "ARCHIVE")) continue;
      const match = usable.find((f) => {
        const parent = f.delimiter ? f.path.slice(0, -f.name.length - f.delimiter.length) : "";
        return (parent === "" || parent === "INBOX") && names.includes(f.name.toLowerCase());
      });
      if (match && ![...roles.values()].includes(match.path)) roles.set(role, match.path);
    }
    const roleOf = new Map([...roles].map(([role, path]) => [path, role]));
    for (const f of usable) {
      const role = roleOf.get(f.path) ?? null;
      this.byPath.set(f.path, {
        path: f.path,
        delimiter: f.delimiter,
        role,
        labelId: role ? SYSTEM_LABELS[role] : f.path,
        name: labelName(f.path, f.delimiter),
      });
    }
    const all = gmail ? list.find((f) => f.selectable && f.specialUse === "\\All") : undefined;
    if (all) {
      this.allMail = all.path;
      this.byPath.set(all.path, {
        path: all.path,
        delimiter: all.delimiter,
        role: null,
        labelId: null,
        name: labelName(all.path, all.delimiter),
        gmailRaw: GMAIL_ARCHIVED,
      });
    }
    const ORDER: Partial<Record<Role, number>> = { INBOX: 0, SENT: 1, DRAFT: 2, SPAM: 4, TRASH: 5 };
    const order = (f: Folder) => (f.role && ORDER[f.role]) ?? 3;
    this.synced = [...this.byPath.values()].sort((a, b) => order(a) - order(b));
    this.archive =
      this.withRole("ARCHIVE") ?? (this.allMail ? this.byPath.get(this.allMail) : undefined);
  }

  get(path: string): Folder | undefined {
    return this.byPath.get(path);
  }

  withRole(role: Role): Folder | undefined {
    return this.synced.find((f) => f.role === role);
  }

  forLabel(labelId: string): Folder | undefined {
    const byRole = (Object.keys(SYSTEM_LABELS) as Role[]).find((r) => SYSTEM_LABELS[r] === labelId);
    return byRole ? this.withRole(byRole) : this.byPath.get(labelId);
  }

  isAllMail(path: string): boolean {
    return path === this.allMail;
  }

  pathFor(name: string): string {
    const sample = this.synced.find((f) => f.delimiter);
    const delimiter = sample?.delimiter ?? "/";
    const underInbox =
      delimiter === "." &&
      this.synced.some((f) => f.role !== "INBOX" && f.path.startsWith("INBOX."));
    return (underInbox ? "INBOX." : "") + name.split("/").join(delimiter);
  }
}

function labelName(path: string, delimiter: string | null): string {
  let name = path;
  if (delimiter && path.toUpperCase().startsWith(`INBOX${delimiter}`)) {
    name = path.slice(6);
  }
  return delimiter && delimiter !== "/" ? name.split(delimiter).join("/") : name;
}

const folderCache = new Map<string, Folders>();

export async function foldersOf(accountId: string, client: ImapClient): Promise<Folders> {
  const cached = folderCache.get(accountId);
  if (cached) return cached;
  return listFolders(accountId, client);
}

export async function listFolders(accountId: string, client: ImapClient): Promise<Folders> {
  const folders = new Folders(await client.list(), client.has("X-GM-EXT-1"));
  folderCache.set(accountId, folders);
  return folders;
}

export function forgetFolders(accountId: string): void {
  folderCache.delete(accountId);
}

const SPECIAL_USE: Record<Exclude<Role, "INBOX">, SpecialUse> = {
  SENT: "\\Sent",
  DRAFT: "\\Drafts",
  TRASH: "\\Trash",
  SPAM: "\\Junk",
  ARCHIVE: "\\Archive",
};

export async function ensureFolder(
  accountId: string,
  client: ImapClient,
  role: Exclude<Role, "INBOX">,
  name: string,
): Promise<Folder> {
  const find = (folders: Folders) =>
    role === "ARCHIVE" ? folders.archive : folders.withRole(role);
  let folders = await foldersOf(accountId, client);
  let folder = find(folders);
  if (folder) return folder;
  folders = await listFolders(accountId, client);
  folder = find(folders);
  if (folder) return folder;
  // Flagged for its use where the server can (RFC 6154), so other apps find it too;
  // a server may refuse the flag (USEATTR), and the name finds it then.
  const path = folders.pathFor(name);
  await client.createMailbox(path, { specialUse: SPECIAL_USE[role] }).catch((err: unknown) => {
    if (!client.has("CREATE-SPECIAL-USE")) throw err;
    return client.createMailbox(path);
  });
  folder = find(await listFolders(accountId, client));
  if (!folder) throw new Error(`Couldn't create a ${name} folder.`);
  return folder;
}

export type MessageRef = { uidValidity: number; uid: number; path: string };

export const messageId = (uidValidity: number, uid: number, path: string): string =>
  `${uidValidity}:${uid}:${path}`;

export function parseMessageId(id: string): MessageRef {
  const match = /^(\d+):(\d+):(.+)$/s.exec(id);
  if (!match) throw new Error(`Not an IMAP message id: ${id}`);
  return { uidValidity: Number(match[1]), uid: Number(match[2]), path: match[3]! };
}

export function byFolder(ids: string[]): Map<string, MessageRef[]> {
  const groups = new Map<string, MessageRef[]>();
  for (const id of ids) {
    const ref = parseMessageId(id);
    const group = groups.get(ref.path);
    if (group) group.push(ref);
    else groups.set(ref.path, [ref]);
  }
  return groups;
}

export function labelsFor(folder: Folder | undefined, flags: string[]): string[] {
  const labels = folder?.labelId ? [folder.labelId] : [];
  const has = new Set(flags.map((f) => f.toLowerCase()));
  if (!has.has("\\seen")) labels.push("UNREAD");
  if (has.has("\\flagged")) labels.push("STARRED");
  if (has.has("\\draft") && !labels.includes("DRAFT")) labels.push("DRAFT");
  return labels;
}
