import { BrowserWindow } from "electron";

export function broadcast(channel: string, params?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, params);
    }
  }
}
