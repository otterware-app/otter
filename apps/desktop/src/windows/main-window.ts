import { app, BrowserWindow, shell } from "electron";

import { logger } from "../logger.js";
import { hostOS } from "../os/index.js";
import { attachBrowser, focusedBrowserPage } from "../services/browser.js";
import { isDriveContent } from "../services/drive-content.js";
import { addContextMenu } from "./context-menu.js";
import { followHistoryButtons } from "./history-buttons.js";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";
import { saveOpenWindows, savedFrame, savedOpenWindows, trackFrame } from "./window-state.js";

/**
 * The app's windows: the main one, and those opened on a place.
 * "The main window" is whichever was focused last: menus, notifications and
 * the Dock act on it.
 */
const windows: BrowserWindow[] = [];
let creating: Promise<BrowserWindow> | null = null;

/**
 * Each window's number, which names its frame.
 * A new window takes the lowest free one. A launch opens the window focused
 * last again, and a restart to update every window that was open.
 */
const keys = new Map<BrowserWindow, number>();
let lastKey = 0;
let launched = false;
let updating = false;

/** Before the updater closes the windows, which it does before "before-quit". */
export function rememberWindowsForUpdate(): void {
  updating = true;
  saveOpenWindows(windows.flatMap((win) => keys.get(win) ?? []));
}
app.on("before-quit", () => {
  if (!updating) saveOpenWindows([lastKey]);
});

function freeKey(): number {
  const used = new Set(keys.values());
  let key = 0;
  while (used.has(key)) key++;
  return key;
}

const frameKey = (key: number) => (key === 0 ? "main" : `window-${key}`);

// A Dock click or a mailto link during startup must not load a window whose
// page invokes channels main hasn't registered yet.
let startupDone!: () => void;
const started = new Promise<void>((resolve) => {
  startupDone = resolve;
});

export function allowWindows(): void {
  startupDone();
}

export function getMainWindow(): BrowserWindow | null {
  return windows.find((win) => !win.isDestroyed()) ?? null;
}

export function focusedAppWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  return focused && windows.includes(focused) ? focused : null;
}

export function openLinksExternally(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    const current = new URL(win.webContents.getURL());
    const next = new URL(url);
    if (next.origin === current.origin) return;
    event.preventDefault();
    if (/^(https?|mailto):$/i.test(next.protocol)) void shell.openExternal(url);
  });
  // Email bodies render in sandboxed iframes: a link that slips past the
  // renderer's click handling must not navigate the frame itself. Drive's
  // documents are frames of Otter Drive's content host, and load there.
  win.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    if (!/^(https?|mailto):/i.test(event.url) || isDriveContent(event.url)) return;
    event.preventDefault();
    void shell.openExternal(event.url);
  });
}

function createAppWindow(
  key: number,
  bounds: { width: number; height: number; x?: number; y?: number },
  hash = "",
): { win: BrowserWindow; loaded: Promise<void> } {
  const chrome = hostOS.mainWindowOptions();
  const win = new BrowserWindow({
    ...chrome,
    ...bounds,
    minWidth: 760,
    minHeight: 520,
    title: app.getName(),
    show: false,
    webPreferences: {
      ...chrome.webPreferences,
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: true,
    },
  });
  windows.push(win);
  keys.set(win, key);
  trackFrame(frameKey(key), win);
  hostOS.windowFollowsTheme(win);
  openLinksExternally(win);
  addContextMenu(win);
  attachBrowser(win);
  followHistoryButtons(win, focusedBrowserPage);

  // Full screen hides the window's buttons, so the page drops the room it keeps for them.
  const sendFullScreen = () => win.webContents.send("window:fullScreen", win.isFullScreen());
  win.on("enter-full-screen", sendFullScreen);
  win.on("leave-full-screen", sendFullScreen);
  win.webContents.on("did-finish-load", sendFullScreen);

  win.once("ready-to-show", () => {
    if (!win.isVisible()) win.show();
  });
  win.on("focus", () => {
    windows.splice(windows.indexOf(win), 1);
    windows.unshift(win);
    lastKey = key;
  });
  win.on("closed", () => {
    const at = windows.indexOf(win);
    if (at >= 0) windows.splice(at, 1);
    keys.delete(win);
    if (windows[0] && key === lastKey) lastKey = keys.get(windows[0]) ?? lastKey;
  });

  const url = `${getWindowUrl("index.html")}${hash}`;
  logger.info("main", "Loading window", { url });
  return { win, loaded: win.loadURL(url) };
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const existing = getMainWindow();
  if (existing) return existing;
  if (creating) return creating;

  creating = (async () => {
    await started;
    const restoring = launched ? [lastKey] : savedOpenWindows();
    launched = true;
    lastKey = restoring[0]!;
    saveOpenWindows([lastKey]);
    const opened = restoring.map((key) => {
      const frame = savedFrame(frameKey(key));
      const { win, loaded } = createAppWindow(key, {
        width: frame?.width ?? 1180,
        height: frame?.height ?? 780,
        ...(frame ? { x: frame.x, y: frame.y } : {}),
      });
      if (frame?.maximized) win.maximize();
      return { win, loaded };
    });
    await Promise.all(opened.map(({ loaded }) => loaded));
    const front = opened[0]!.win;
    if (!front.isDestroyed()) front.focus();
    return front;
  })().finally(() => {
    creating = null;
  });
  return creating;
}

/** A window of its own for a place (⌘-click, or "Open in New Window"), beside the focused one. */
export function openPlaceWindow(href: string): void {
  const from = focusedAppWindow() ?? getMainWindow();
  const [width, height] = from?.getSize() ?? [1180, 780];
  const [x, y] = from?.getPosition() ?? [];
  const { win, loaded } = createAppWindow(
    freeKey(),
    { width: width!, height: height!, ...(x !== undefined ? { x: x + 24, y: y! + 24 } : {}) },
    `#${href}`,
  );
  loaded.catch((error: unknown) => {
    if (!win.isDestroyed()) logger.error("main", "Failed to load a new window", error);
  });
}

export async function focusMainWindow(): Promise<BrowserWindow> {
  const win = getMainWindow() ?? (await createMainWindow());
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  return win;
}
