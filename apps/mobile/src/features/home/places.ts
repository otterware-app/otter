import { buildLabelTree, flattenLabelTree } from "@otter-mail/client-runtime/label-tree";
import type { MailLabel } from "@otter-mail/client-runtime/mail";
import type { MailCapabilities } from "@otter-mail/contracts";
import type { SFSymbol } from "expo-symbols";
import { Atom } from "effect/reactivity";

import { clientPlatform } from "../../state/client";

/** Where Home is: a mailbox's label (its folders, for Outlook and IMAP). */
export type Place = { accountId: string | null; labelId: string };

const PLACE_KEY = "mobile:place";

function savedPlace(): Place {
  try {
    const raw = clientPlatform.storage.getItem(PLACE_KEY);
    if (raw) return JSON.parse(raw) as Place;
  } catch {
    // a place from an older build: start in the inbox
  }
  return { accountId: null, labelId: "INBOX" };
}

export const placeAtom = Atom.make<Place>(savedPlace()).pipe(Atom.keepAlive);

export function rememberPlace(place: Place): void {
  clientPlatform.storage.setItem(PLACE_KEY, JSON.stringify(place));
}

/** The Swift app's Folder: the system places, in the order its menu lists them. */
const SYSTEM: Record<string, { title: string; symbol: SFSymbol; order: number }> = {
  INBOX: { title: "Inbox", symbol: "tray", order: 0 },
  STARRED: { title: "Starred", symbol: "star", order: 1 },
  SNOOZED: { title: "Snoozed", symbol: "clock", order: 2 },
  SENT: { title: "Sent", symbol: "paperplane", order: 3 },
  DRAFT: { title: "Drafts", symbol: "doc", order: 4 },
  IMPORTANT: { title: "Important", symbol: "bookmark", order: 5 },
  ARCHIVE: { title: "Archive", symbol: "archivebox", order: 6 },
  ALL_MAIL: { title: "All Mail", symbol: "tray.full", order: 7 },
  SPAM: { title: "Junk", symbol: "xmark.bin", order: 8 },
  TRASH: { title: "Trash", symbol: "trash", order: 9 },
};

export const isSystem = (labelId: string) => labelId in SYSTEM;

/** Gmail's stars are Outlook's and IMAP's flags (the Swift app's Folder.title(in:)). */
const flags = (capabilities?: MailCapabilities) =>
  capabilities !== undefined && !capabilities.stars;

export function placeTitle(
  labelId: string,
  labels: readonly MailLabel[],
  capabilities?: MailCapabilities,
): string {
  if (labelId === "STARRED" && flags(capabilities)) return "Flagged";
  const name = SYSTEM[labelId]?.title ?? labels.find((l) => l.id === labelId)?.name ?? labelId;
  return name.split("/").at(-1) ?? name;
}

export function placeSymbol(
  labelId: string,
  selected = false,
  capabilities?: MailCapabilities,
): SFSymbol {
  const symbol =
    labelId === "STARRED" && flags(capabilities) ? "flag" : (SYSTEM[labelId]?.symbol ?? "tag");
  return selected ? (`${symbol}.fill` as SFSymbol) : symbol;
}

/** The mailbox's system places, in the menu's order. */
export function folders(labels: readonly MailLabel[]): MailLabel[] {
  return labels
    .filter((l) => SYSTEM[l.id])
    .sort((a, b) => SYSTEM[a.id]!.order - SYSTEM[b.id]!.order);
}

/** Its own labels (folders, for Outlook and IMAP), nested by "/" as the desktop shows them. */
export function ownLabels(
  labels: readonly MailLabel[],
): { label: MailLabel; name: string; depth: number }[] {
  const own = labels.filter((l) => l.type === "user" && !SYSTEM[l.id]);
  return flattenLabelTree(buildLabelTree(own)).flatMap(({ node, depth }) =>
    node.label ? [{ label: node.label, name: node.segment, depth }] : [],
  );
}

/** What the badge counts: unread in the inbox and in labels, everything in Drafts. */
export function placeCount(label: MailLabel): number {
  if (label.id === "DRAFT") return label.total ?? 0;
  if (label.id === "INBOX" || label.id === "SPAM" || label.type === "user")
    return label.unread ?? 0;
  return 0;
}
