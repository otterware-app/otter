import { openLink, type BodyLinks, type PaletteSearch } from "@otter-mail/web/extension-kit";
import { FileTextIcon } from "lucide-react";

import { SHARED, driveApi } from "./api";

/** Opens Drive at a place: set by the mounted dialogs, which can navigate. */
let opener: ((location: string, item: string | null) => void) | null = null;
export function setDriveOpener(open: typeof opener) {
  opener = open;
}

/** ⌘K's Drive results: documents in the drives that are on. */
export const paletteSearch: PaletteSearch = {
  label: "Drive",
  search: async (query) => {
    const status = await driveApi.status();
    if (!status.connected) return [];
    return (await driveApi.search(query)).map((a) => ({
      id: `otter-drive:${a.id}`,
      title: a.title,
      description: a.description || a.current?.entryPath,
      Icon: FileTextIcon,
      run: () => opener?.(a.folderId || SHARED, a.id),
    }));
  },
};

/** Whether Drive is signed in here: links in mail open in Drive only then. */
let connected = false;
export function setDriveConnected(value: boolean) {
  connected = value;
}

const DRIVE_LINK =
  /^https:\/\/drive\.otterware\.app\/(?:s\/[^/?#]+|[^/?#]+\/a\/[^/?#]+|home\?(?:[^#]*&)?folder=)/;

/**
 * Drive's links in an email (a shared link, a document's page, a folder) open
 * in Drive rather than the browser; one that doesn't resolve opens as usual.
 */
export const bodyLinks: BodyLinks = {
  applies: (detail) =>
    connected && `${detail.bodyHtml ?? ""}${detail.bodyText ?? ""}`.includes("drive.otterware.app"),
  // An answer is a word (`[\w-]+`), so the link travels as base64url.
  answer: (href) => (DRIVE_LINK.test(href) ? toWord(href) : null),
  open: (_messageId, answer) => {
    const href = fromWord(answer);
    if (!href || !DRIVE_LINK.test(href)) return;
    void driveApi.resolveLink(href).then(
      (to) => (to && opener ? opener(to.location, to.item) : openLink(href)),
      () => openLink(href),
    );
  },
};

const toWord = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fromWord(word: string): string | null {
  try {
    const binary = atob(word.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
