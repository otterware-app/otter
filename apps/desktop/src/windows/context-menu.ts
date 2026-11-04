import {
  Menu,
  app,
  clipboard,
  shell,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

export function editingItems(
  page: WebContents,
  params: ContextMenuParams,
): MenuItemConstructorOptions[][] {
  const groups: MenuItemConstructorOptions[][] = [];
  const suggestions = params.dictionarySuggestions.slice(0, 5);
  if (suggestions.length > 0) {
    groups.push(
      suggestions.map((word) => ({ label: word, click: () => page.replaceMisspelling(word) })),
    );
  }
  groups.push([
    { label: "Cut", enabled: params.editFlags.canCut, click: () => page.cut() },
    { label: "Copy", enabled: params.editFlags.canCopy, click: () => page.copy() },
    { label: "Paste", enabled: params.editFlags.canPaste, click: () => page.paste() },
    { label: "Select All", click: () => page.selectAll() },
  ]);
  return groups;
}

// The app's own menus (message list, sidebars) cancel the DOM event, so this
// only shows where they don't: mail bodies, text fields, links.
export function addContextMenu(win: BrowserWindow): void {
  const page = win.webContents;
  page.on("context-menu", (_event, params) => {
    const groups: MenuItemConstructorOptions[][] = [];
    if (/^https?:/i.test(params.linkURL)) {
      groups.push([
        {
          label: "Open Link in Default Browser",
          click: () => void shell.openExternal(params.linkURL),
        },
        { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
      ]);
    } else if (/^mailto:/i.test(params.linkURL)) {
      const address = params.linkURL.slice(7).split("?")[0].replaceAll("%40", "@");
      groups.push([{ label: "Copy Address", click: () => clipboard.writeText(address) }]);
    }
    if (params.mediaType === "image" && params.hasImageContents) {
      groups.push([{ label: "Copy Image", click: () => page.copyImageAt(params.x, params.y) }]);
    }
    if (params.isEditable) {
      groups.push(...editingItems(page, params));
    } else if (params.selectionText.trim()) {
      groups.push([{ label: "Copy", click: () => page.copy() }]);
    }
    if (!app.isPackaged) {
      groups.push([
        { label: "Inspect Element", click: () => page.inspectElement(params.x, params.y) },
      ]);
    }
    if (groups.length === 0) return;
    const items = groups.flatMap((group, i) =>
      i === 0 ? group : [{ type: "separator" as const }, ...group],
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
