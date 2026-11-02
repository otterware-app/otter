import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

type SavedFrame = Rectangle & { maximized?: boolean };

const SAVE_DELAY_MS = 400;

function stateFile(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readAll(): Record<string, SavedFrame> {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8")) as Record<string, SavedFrame>;
  } catch {
    return {};
  }
}

function isVisible(frame: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX =
      Math.min(frame.x + frame.width, workArea.x + workArea.width) - Math.max(frame.x, workArea.x);
    const overlapY =
      Math.min(frame.y + frame.height, workArea.y + workArea.height) -
      Math.max(frame.y, workArea.y);
    return overlapX >= 100 && overlapY >= 50;
  });
}

export function savedFrame(key: string): SavedFrame | null {
  const frame = readAll()[key];
  if (!frame || typeof frame.width !== "number" || !isVisible(frame)) return null;
  return frame;
}

export function trackFrame(key: string, win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const all = readAll();
    all[key] = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.writeFileSync(stateFile(), JSON.stringify(all, null, 2));
    } catch {
      // Losing a window position is not worth surfacing.
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
