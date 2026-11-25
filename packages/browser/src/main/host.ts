import type {
  BrowserWindow,
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents,
} from "electron";

type Log = (scope: string, message: string, details?: unknown) => void;

/** What the browser asks of the app that hosts it, given once to `setupBrowser`. */
export type BrowserHost = {
  logger: { info: Log; warn: Log; error: Log };
  /** Sends an event to every window of the app's. */
  broadcast(channel: string, params?: unknown): void;
  /** The window extensions' tabs and popups belong to. */
  mainWindow(): BrowserWindow | null;
  modifierKey: "metaKey" | "ctrlKey";
  /** Cut, copy, paste… for an editable field's context menu, grouped. */
  editingItems(page: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[][];
  /** Mouse back and forward buttons on a page. */
  followHistoryButtons(page: WebContents): void;
  /** A page opening a URL in another app; true when the app took it (a mailto: it composes). */
  openInApp?(url: string): boolean;
};

let current: BrowserHost | null = null;

export function setBrowserHost(host: BrowserHost): void {
  current = host;
}

export function host(): BrowserHost {
  if (!current) throw new Error("The browser isn't set up: call setupBrowser first.");
  return current;
}
