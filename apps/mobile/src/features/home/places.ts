import type { MailLabel } from "@otter-mail/client-runtime/mail";
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

const SYSTEM: Record<string, { title: string; symbol: SFSymbol; order: number }> = {
  INBOX: { title: "Inbox", symbol: "tray", order: 0 },
  STARRED: { title: "Starred", symbol: "star", order: 1 },
  SNOOZED: { title: "Snoozed", symbol: "clock", order: 2 },
  IMPORTANT: { title: "Important", symbol: "bookmark", order: 3 },
  SENT: { title: "Sent", symbol: "paperplane", order: 4 },
  DRAFT: { title: "Drafts", symbol: "doc", order: 5 },
  ALL_MAIL: { title: "All Mail", symbol: "archivebox", order: 6 },
  ARCHIVE: { title: "Archive", symbol: "archivebox", order: 6 },
  SPAM: { title: "Junk", symbol: "xmark.bin", order: 7 },
  TRASH: { title: "Trash", symbol: "trash", order: 8 },
};

export const isSystem = (labelId: string) => labelId in SYSTEM;

export function placeTitle(labelId: string, labels: readonly MailLabel[]): string {
  return SYSTEM[labelId]?.title ?? labels.find((l) => l.id === labelId)?.name ?? labelId;
}

export function placeSymbol(labelId: string): SFSymbol {
  return SYSTEM[labelId]?.symbol ?? "tag";
}

/** The mailbox's places in the order the bar's menu lists them: system ones first, then its own. */
export function orderedPlaces(labels: readonly MailLabel[]): MailLabel[] {
  const system = labels
    .filter((l) => SYSTEM[l.id] && !l.id.startsWith("CATEGORY_"))
    .sort((a, b) => SYSTEM[a.id]!.order - SYSTEM[b.id]!.order);
  const own = labels
    .filter((l) => l.type === "user" && !SYSTEM[l.id])
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...own];
}
