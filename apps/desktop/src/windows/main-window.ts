import { app, BrowserWindow, screen, shell, type WebContents } from "electron";

import { logger } from "../logger.js";
import { hostOS } from "../os/index.js";
import { attachBrowser } from "../services/browser.js";
import { isDriveContent } from "../services/drive-content.js";
import { getPreloadPath, getWindowUrl } from "./window-paths.js";
import { savedFrame, trackFrame } from "./window-state.js";

const FRAME_KEY = "main";

/**
 * The app's windows: the main one, and those a tab was dragged out into.
 * "The main window" is whichever was focused last: menus, notifications and
 * the Dock act on it.
 */
const windows: BrowserWindow[] = [];
let creating: Promise<BrowserWindow> | null = null;

export function getMainWindow(): BrowserWindow | null {
  return windows.find((win) => !win.isDestroyed()) ?? null;
}

/** Whether the focused window is one of the app's (not Settings' or an extension's popup). */
export function focusedAppWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  return focused && windows.includes(focused) ? focused : null;
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

function createAppWindow(
  bounds: { width: number; height: number; x?: number; y?: number },
  search = "",
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
  hostOS.windowFollowsTheme(win);
  openLinksExternally(win);
  attachBrowser(win);

  win.once("ready-to-show", () => {
    if (!win.isVisible()) win.show();
  });
  win.on("focus", () => {
    windows.splice(windows.indexOf(win), 1);
    windows.unshift(win);
  });
  win.on("closed", () => {
    const at = windows.indexOf(win);
    if (at >= 0) windows.splice(at, 1);
  });

  const url = getWindowUrl("index.html") + search + hash;
  logger.info("main", "Loading window", { url });
  return { win, loaded: win.loadURL(url) };
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const existing = getMainWindow();
  if (existing) return existing;
  if (creating) return creating;

  creating = (async () => {
    const frame = savedFrame(FRAME_KEY);
    const { win, loaded } = createAppWindow({
      width: frame?.width ?? 1180,
      height: frame?.height ?? 780,
      ...(frame ? { x: frame.x, y: frame.y } : {}),
    });
    if (frame?.maximized) win.maximize();
    trackFrame(FRAME_KEY, win);
    await loaded;
    return win;
  })().finally(() => {
    creating = null;
  });
  return creating;
}

/** The window a tab is being dragged out into, following the pointer until it's let go. */
/** A window tab on the move between windows: where it goes, and what it's called. */
export type CarriedTab = { href: string; title: string; icon: string };
type Point = { x: number; y: number };

/** The window tabs' bar, across the top of each app window (the renderer's --workspace-topbar-height). */
const TAB_BAR_HEIGHT = 42;

/**
 * The window a tab drag is carrying: a new one for a tab pulled off a strip,
 * or the window itself when that was its only tab. It follows the pointer of
 * `from`, the window the drag began in (which keeps the pointer throughout),
 * held at `grab` from its top-left. Over another window's tab bar it hides,
 * and that window shows where the tab would land (`target`).
 */
type Carried = {
  win: BrowserWindow;
  from: WebContents;
  tab: CarriedTab;
  grab: Point;
  target: BrowserWindow | null;
  /** When `from` last said its pointer moved. */
  moved: number;
  /** Following on its own, should `from` fall quiet (busy rendering). */
  timer: ReturnType<typeof setInterval>;
  /** Stops listening to `from`. */
  unwatch: () => void;
};
let carried: Carried | null = null;

const FRAME_MS = 1000 / 60;

function carry(win: BrowserWindow, from: WebContents, tab: CarriedTab, grab: Point): void {
  if (carried) dropTabWindow(carried.from);
  // A drag that can't end (its window reloads, crashes or closes) lets go.
  const end = () => dropTabWindow(from);
  const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) end();
  };
  from.once("destroyed", end);
  from.once("render-process-gone", end);
  from.on("did-start-navigation", onNavigate);
  const unwatch = () => {
    if (from.isDestroyed()) return;
    from.off("destroyed", end);
    from.off("render-process-gone", end);
    from.off("did-start-navigation", onNavigate);
  };
  const timer = setInterval(() => {
    if (carried?.from === from && Date.now() - carried.moved > FRAME_MS * 1.5) follow(carried);
  }, FRAME_MS);
  carried = { win, from, tab, grab, target: null, moved: Date.now(), timer, unwatch };
}

/** A tab pulled off `from`'s strip, in a window of its own the size of the one it left. */
export function openTabWindow(from: WebContents, tab: CarriedTab, grab: Point): void {
  const at = screen.getCursorScreenPoint();
  const [width, height] = BrowserWindow.fromWebContents(from)?.getSize() ?? [1180, 780];
  const search = new URLSearchParams({ window: "tab", title: tab.title, icon: tab.icon });
  const { win, loaded } = createAppWindow(
    { width: width!, height: height!, x: Math.round(at.x - grab.x), y: Math.round(at.y - grab.y) },
    `?${search}`,
    `#${tab.href}`,
  );
  loaded.catch((error: unknown) => logger.error("main", "Failed to load a tab's window", error));
  // Inactive: the window the drag began in keeps the pointer until it's let go.
  win.showInactive();
  carry(win, from, tab, grab);
}

/** `from`'s only tab is being dragged: the window goes with it. */
export function carryWindow(from: WebContents, tab: CarriedTab, grab: Point): void {
  const win = BrowserWindow.fromWebContents(from);
  // A full-screen window stays put (it's a space of its own).
  if (!win || !windows.includes(win) || win.isFullScreen()) return;
  if (win.isMaximized()) win.unmaximize();
  carry(win, from, tab, grab);
}

/**
 * The app window whose tab bar is at a point on the screen, the last focused
 * first; not one still loading, which could miss the tab.
 */
function tabBarAt(point: Point, except: BrowserWindow[]): BrowserWindow | null {
  return (
    windows.find((win) => {
      if (win.isDestroyed() || except.includes(win) || !win.isVisible() || win.isMinimized())
        return false;
      if (win.webContents.isLoading()) return false;
      const bounds = win.getContentBounds();
      return (
        point.x >= bounds.x &&
        point.x < bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y < bounds.y + TAB_BAR_HEIGHT
      );
    }) ?? null
  );
}

function hover(target: BrowserWindow | null, tab: CarriedTab | null, point: Point): void {
  if (!target || target.isDestroyed()) return;
  const x = point.x - target.getContentBounds().x;
  target.webContents.send("window:tabHover", tab ? { tab, x } : null);
}

/**
 * Puts the carried window under the cursor, and finds the tab bar it's over.
 * Where to is the cursor's own place, not a pointer event's: a window moving
 * under the pointer would otherwise chase its own lagging coordinates, and shake.
 */
function follow(current: Carried): void {
  if (current.win.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const source = current.from.isDestroyed() ? null : BrowserWindow.fromWebContents(current.from);
  const target = tabBarAt(point, source ? [current.win, source] : [current.win]);
  if (target !== current.target) {
    hover(current.target, null, point);
    current.target = target;
    current.win.setOpacity(target ? 0 : 1);
  }
  if (target) hover(target, current.tab, point);
  const [x, y] = [Math.round(point.x - current.grab.x), Math.round(point.y - current.grab.y)];
  const [left, top] = current.win.getPosition();
  if (x !== left || y !== top) current.win.setPosition(x, y);
}

/** The pointer of `from`'s drag moved: the window it carries follows. */
export function carryTabWindow(from: WebContents): void {
  if (carried?.from !== from) return;
  carried.moved = Date.now();
  follow(carried);
}

/** Ends `from`'s carry: no more following, no tab shown landing anywhere, the window shown. */
function letGo(from: WebContents): Carried | null {
  const current = carried;
  if (!current || current.from !== from) return null;
  carried = null;
  clearInterval(current.timer);
  current.unwatch();
  hover(current.target, null, { x: 0, y: 0 });
  if (current.win.isDestroyed()) return null;
  current.win.setOpacity(1);
  return current;
}

/**
 * `from`'s drag let go: over another window's tab bar (where the cursor is
 * now), the tab joins that window and the one carrying it closes; elsewhere
 * that window stays there.
 */
export function dropTabWindow(from: WebContents): void {
  if (carried?.from === from) follow(carried);
  const target = carried?.from === from ? carried.target : null;
  const current = letGo(from);
  if (!current) return;
  if (target && !target.isDestroyed()) {
    const point = screen.getCursorScreenPoint();
    target.webContents.send("window:receiveTab", {
      tab: current.tab,
      x: point.x - target.getContentBounds().x,
    });
    target.focus();
    current.win.destroy();
    return;
  }
  current.win.focus();
}

/** Closes the window `from`'s drag was carrying: its tab went back. */
export function returnTabWindow(from: WebContents): void {
  const current = letGo(from);
  if (current && current.win.webContents !== from) current.win.destroy();
}

export async function focusMainWindow(): Promise<BrowserWindow> {
  const win = getMainWindow() ?? (await createMainWindow());
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  return win;
}
