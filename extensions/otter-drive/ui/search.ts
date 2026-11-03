import type { PaletteSearch } from "@otter-mail/web/extension-kit";
import { FileTextIcon } from "lucide-react";

import { SHARED, driveApi } from "./api";

/** Opens Drive at a place: set by the mounted dialogs, which can navigate. */
let opener: ((location: string, item: string) => void) | null = null;
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
