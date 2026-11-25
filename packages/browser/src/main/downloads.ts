import { app, ipcMain, shell, type DownloadItem, type Session } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import { host } from "./host.ts";

export type Download = {
  id: number;
  filename: string;
  url: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  received: number;
  total: number;
  startTime: number;
  paused: boolean;
};

const downloads = new Map<number, { download: Download; item: DownloadItem | null }>();
let nextId = 0;

/** A name not yet taken in the folder: "report.pdf", then "report (1).pdf"… (Chrome's). */
function freePath(dir: string, filename: string): string {
  const { name, ext } = path.parse(filename);
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n === 0 ? filename : `${name} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

const changed = () => host().broadcast("browser:downloadsChanged");

export function listDownloads(): Download[] {
  return [...downloads.values()]
    .map((d) => d.download)
    .toSorted((a, b) => b.startTime - a.startTime);
}

export function downloadItem(id: number): DownloadItem | null {
  return downloads.get(id)?.item ?? null;
}

/** Downloads go straight to the Downloads folder, as Chrome's do, and are listed in the toolbar. */
export function setupDownloads(ses: Session): void {
  ses.on("will-download", (_event, item) => {
    const savePath = freePath(app.getPath("downloads"), item.getFilename());
    item.setSavePath(savePath);
    const download: Download = {
      id: ++nextId,
      filename: path.basename(savePath),
      url: item.getURL(),
      path: savePath,
      state: "progressing",
      received: 0,
      total: item.getTotalBytes(),
      startTime: Date.now(),
      paused: false,
    };
    downloads.set(download.id, { download, item });
    host().broadcast("browser:downloadStarted", { id: download.id });
    changed();
    let last = 0;
    item.on("updated", (_e, state) => {
      download.state = state === "interrupted" ? "interrupted" : "progressing";
      download.received = item.getReceivedBytes();
      download.total = item.getTotalBytes();
      download.paused = item.isPaused();
      // Progress at most a few times a second: IPC stays small.
      if (Date.now() - last > 250) {
        last = Date.now();
        changed();
      }
    });
    item.once("done", (_e, state) => {
      download.state = state;
      download.received = item.getReceivedBytes();
      downloads.set(download.id, { download, item: null });
      host().logger.info("browser", "Download done", { state });
      changed();
    });
  });

  ipcMain.handle("browser:downloads", () => listDownloads());
  ipcMain.handle("browser:downloadAction", (_event, params: unknown) => {
    const { id, action } = (params ?? {}) as { id?: unknown; action?: unknown };
    const entry = typeof id === "number" ? downloads.get(id) : undefined;
    if (!entry) return;
    const { download, item } = entry;
    switch (action) {
      case "open":
        void shell.openPath(download.path);
        break;
      case "show":
        shell.showItemInFolder(download.path);
        break;
      case "cancel":
        item?.cancel();
        break;
      case "pause":
        item?.pause();
        break;
      case "resume":
        item?.resume();
        break;
      case "remove":
        item?.cancel();
        downloads.delete(download.id);
        changed();
        break;
    }
  });
  ipcMain.handle("browser:clearDownloads", () => {
    for (const [id, { item }] of downloads) if (!item) downloads.delete(id);
    changed();
  });
}
