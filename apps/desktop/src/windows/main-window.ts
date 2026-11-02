import { app, BrowserWindow, shell } from "electron";

import { logger } from "../logger.js";
import { hostOS } from "../os/index.js";
import { attachBrowser } from "../services/browser.js";
import { isDriveContent } from "../services/drive-content.js";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";
import { savedFrame, trackFrame } from "./window-state.js";

const FRAME_KEY = "main";

let mainWindow: BrowserWindow | null = null;
let creating: Promise<BrowserWindow> | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Links clicked in mail or chat open in the browser, never in a new app window. */
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

export async function createMainWindow(): Promise<BrowserWindow> {
  const existing = getMainWindow();
  if (existing) return existing;
  if (creating) return creating;

  creating = (async () => {
    const frame = savedFrame(FRAME_KEY);
    const chrome = hostOS.mainWindowOptions();
    const win = new BrowserWindow({
      ...chrome,
      width: frame?.width ?? 1180,
      height: frame?.height ?? 780,
      ...(frame ? { x: frame.x, y: frame.y } : {}),
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
    mainWindow = win;
    if (frame?.maximized) win.maximize();
    trackFrame(FRAME_KEY, win);
    hostOS.windowFollowsTheme(win);
    openLinksExternally(win);
    attachBrowser(win);

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      if (mainWindow === win) mainWindow = null;
    });

    const url = getWindowUrl("index.html");
    logger.info("main", "Loading main window", { url });
    await win.loadURL(url);
    return win;
  })().finally(() => {
    creating = null;
  });
  return creating;
}

export async function focusMainWindow(): Promise<void> {
  const win = getMainWindow() ?? (await createMainWindow());
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
}
