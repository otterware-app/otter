import { BrowserWindow, ipcMain, webContents } from "electron";

import { logger } from "../logger.js";
import { clearBrowsingData, getBrowserSession } from "../services/browser.js";
import {
  extensionActions,
  listExtensions,
  loadUnpacked,
  removeExtension,
  runAction,
  setActiveTab,
  setExtensionEnabled,
} from "../services/extensions.js";
import { shareTab, sharingStatus } from "../services/tab-sharing.js";

export function registerBrowserHandlers(): void {
  ipcMain.handle("browser:extensions", () => listExtensions());

  ipcMain.handle("browser:removeExtension", async (_event, id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid parameters for browser:removeExtension.");
    logger.info("browser", "Remove extension", { id });
    await removeExtension(id);
  });

  ipcMain.handle("browser:setExtensionEnabled", async (_event, params: unknown) => {
    const { id, enabled } = (params ?? {}) as { id?: unknown; enabled?: unknown };
    if (typeof id !== "string" || typeof enabled !== "boolean") {
      throw new Error("Invalid parameters for browser:setExtensionEnabled.");
    }
    await setExtensionEnabled(id, enabled);
  });

  ipcMain.handle("browser:loadUnpacked", (event) =>
    loadUnpacked(BrowserWindow.fromWebContents(event.sender)),
  );

  ipcMain.handle("browser:extensionActions", () => extensionActions());

  ipcMain.handle("browser:runAction", (_event, params: unknown) => {
    const { id, anchor } = (params ?? {}) as {
      id?: unknown;
      anchor?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
    };
    const box = [anchor?.x, anchor?.y, anchor?.width, anchor?.height];
    if (typeof id !== "string" || !box.every((n) => typeof n === "number")) {
      throw new Error("Invalid parameters for browser:runAction.");
    }
    const [x, y, width, height] = box as number[];
    runAction(id, { x: x!, y: y!, width: width!, height: height! });
  });

  ipcMain.handle("browser:activeTab", (_event, webContentsId: unknown) => {
    if (typeof webContentsId === "number") setActiveTab(webContentsId);
  });

  ipcMain.handle("browser:share", async (event, params: unknown) => {
    const { webContentsId, share } = (params ?? {}) as { webContentsId?: unknown; share?: unknown };
    const page = typeof webContentsId === "number" ? webContents.fromId(webContentsId) : undefined;
    if (
      !page ||
      typeof share !== "boolean" ||
      page.getType() !== "webview" ||
      page.session !== getBrowserSession() ||
      page.hostWebContents !== event.sender
    ) {
      throw new Error("Invalid parameters for browser:share.");
    }
    await shareTab(page, share);
  });

  ipcMain.handle("browser:sharing", () => sharingStatus());

  ipcMain.handle("browser:clearData", async (_event, params: unknown) => {
    const origin = (params as { origin?: unknown } | undefined)?.origin;
    if (origin !== undefined && (typeof origin !== "string" || !/^https?:\/\//.test(origin))) {
      throw new Error("Invalid parameters for browser:clearData.");
    }
    logger.info("browser", "Clear browsing data", { origin: origin ?? "all" });
    await clearBrowsingData(origin);
  });
}
