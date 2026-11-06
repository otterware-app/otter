import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { connectCore } from "@otter-mail/client-runtime/connection";
import type { HostEffect, HostRequest } from "@otter-mail/contracts/rpc";
import type { AppSettings } from "@otter-mail/core";

import { appInfoEnv } from "./backend-protocol.js";
import { setErrorReportsAllowed, sendsErrorReports } from "./error-reports.js";
import { broadcast } from "./ipc.js";
import { logger, writeLog } from "./logger.js";
import { hostOS } from "./os/index.js";
import { setPendingOpenMessage } from "./services/open-message-target.js";
import { focusMainWindow } from "./windows/main-window.js";

let backend: UtilityProcess | null = null;
let stopping = false;
let ready: Promise<void> = Promise.resolve();
const forwarded = new Set<string>();

const RESTART_DELAY_MS = 1_000;
const RESTART_DELAY_MAX_MS = 30_000;
let restartDelay = RESTART_DELAY_MS;

function forkBackend(): UtilityProcess {
  const child = utilityProcess.fork(path.join(__dirname, "backend.cjs"), [], {
    serviceName: "Otter Mail Backend",
    env: {
      ...process.env,
      ...appInfoEnv({
        stateDir: app.getPath("userData"),
        version: app.getVersion(),
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        errorReports: sendsErrorReports,
      }),
    },
  });
  backend = child;
  child.on("exit", (code) => {
    if (backend === child) backend = null;
    core?.stop("The mail backend stopped.");
    if (stopping) return;
    logger.error("backend", `The mail backend exited (${code}); starting it again`);
    setTimeout(() => void startBackend(), restartDelay);
    restartDelay = Math.min(restartDelay * 2, RESTART_DELAY_MAX_MS);
  });
  return child;
}

let core: ReturnType<typeof connectCore> | null = null;

export function startBackend(): Promise<void> {
  const open = () => {
    const child = forkBackend();
    return {
      post: (message: unknown) => child.postMessage(message, []),
      listen(listener: (message: unknown) => void) {
        child.on("message", listener);
        return () => child.off("message", listener);
      },
    };
  };
  if (core) core.restart();
  else core = connectCore(open, { onEvent: broadcast, onRequest: answer, onEffect: carryOut });
  ready = core.ready().then((channels) => {
    serve(channels);
    restartDelay = RESTART_DELAY_MS;
  });
  return ready;
}

export function stopBackend(): void {
  stopping = true;
  core?.shutdown();
}

export async function invokeBackend(channel: string, params?: unknown): Promise<unknown> {
  await ready;
  if (!core) throw new Error("The mail backend stopped.");
  return core.invoke(channel, params);
}

function serve(channels: readonly string[]): void {
  for (const channel of channels) {
    if (forwarded.has(channel)) continue;
    forwarded.add(channel);
    ipcMain.handle(channel, (_event, params: unknown) => invokeBackend(channel, params));
  }
}

void app.whenReady().then(() => powerMonitor.on("resume", () => core?.resume()));

async function answer(request: HostRequest): Promise<unknown> {
  switch (request._tag) {
    case "seal":
      return safeStorage.encryptString(request.text).toString("base64");
    case "unseal":
      return safeStorage.decryptString(Buffer.from(request.sealed, "base64"));
    case "openExternal":
      await shell.openExternal(request.url);
      return;
    case "openFile": {
      const error = await shell.openPath(await tempFile(request.name, request.bytes));
      if (error) throw new Error(error);
      return;
    }
    case "saveFile": {
      const result = await dialog.showSaveDialog({ defaultPath: request.name });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, request.bytes);
      return true;
    }
    case "pickFiles": {
      const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
      if (result.canceled) return [];
      return Promise.all(
        result.filePaths.map(async (file) => ({
          name: path.basename(file),
          mimeType:
            MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream",
          bytes: new Uint8Array(await fs.readFile(file)),
        })),
      );
    }
    default:
      throw new Error(`The desktop app doesn't answer ${request._tag}.`);
  }
}

const MAX_AWAITING_CLICK = 50;
const notificationsAwaitingClick = new Set<Notification>();

function carryOut(effect: HostEffect): void {
  switch (effect._tag) {
    case "notify": {
      const { _tag: _kind, open, code, ...options } = effect;
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        ...options,
        ...(code && { actions: [{ type: "button" as const, text: "Copy & trash" }] }),
      });
      notificationsAwaitingClick.add(notification);
      if (notificationsAwaitingClick.size > MAX_AWAITING_CLICK) {
        notificationsAwaitingClick.delete(notificationsAwaitingClick.values().next().value!);
      }
      notification.on("click", () => {
        notificationsAwaitingClick.delete(notification);
        if (open) setPendingOpenMessage(open);
        void focusMainWindow().then((win) => open && win.webContents.send("mail:open"));
      });
      notification.on("action", () => {
        notificationsAwaitingClick.delete(notification);
        if (!code) return;
        clipboard.writeText(code);
        if (open) {
          invokeBackend("gmail:trashMessage", open).catch((err: unknown) =>
            logger.warn("notify", "trashing the code's mail failed", String(err)),
          );
        }
      });
      notification.show();
      return;
    }
    case "badge":
      unreadCount = effect.count;
      showDockBadge();
      return;
    case "settings":
      applySettings(effect.settings as AppSettings, effect.patch as Partial<AppSettings>);
      return;
    case "log":
      writeLog(effect.level, effect.scope, effect.message, effect.data);
      return;
  }
}

let unreadCount = 0;
let dockBadgeEnabled = false;

function showDockBadge(): void {
  hostOS.setBadge(dockBadgeEnabled ? unreadCount : 0);
}

export function setDockBadgeEnabled(enabled: boolean): void {
  dockBadgeEnabled = enabled;
  showDockBadge();
}

function applySettings(settings: AppSettings, patch: Partial<AppSettings>): void {
  if (patch.dockBadgeEnabled !== undefined) {
    setDockBadgeEnabled(settings.dockBadgeEnabled);
  }
  if (patch.launchAtLogin !== undefined) {
    hostOS.setLaunchAtLogin(settings.launchAtLogin);
  }
  if (patch.errorReports !== undefined) {
    setErrorReportsAllowed(settings.errorReports);
  }
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  xml: "application/xml",
  ics: "text/calendar",
  zip: "application/zip",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[/\\]/g, "_").replace(/^\.+/, "").trim();
  return cleaned || "attachment";
}

export async function tempFile(name: string, bytes: Uint8Array): Promise<string> {
  const key = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const file = path.join(app.getPath("temp"), "otter-mail-files", key, sanitizeFilename(name));
  const existing = await fs.stat(file).catch(() => null);
  if (!existing || existing.size !== bytes.length) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, file);
  }
  return file;
}
