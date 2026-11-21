import {
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
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

import type { AppSettings } from "@otter/core";

import {
  appInfoEnv,
  type FromBackend,
  type MainEffect,
  type MainRequests,
  type ToBackend,
} from "./backend-protocol.js";
import { reportedByBackend, setErrorReportsAllowed, sendsErrorReports } from "./error-reports.js";
import { broadcast } from "./ipc.js";
import { logger, writeLog } from "./logger.js";
import { hostOS } from "./os/index.js";
import { setPendingOpenMessage } from "./services/open-message-target.js";
import { focusMainWindow, getMainWindow } from "./windows/main-window.js";

let backend: UtilityProcess | null = null;
let stopping = false;
let ready: Promise<void> = Promise.resolve();
let nextInvokeId = 1;
const invoking = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const forwarded = new Set<string>();
reportedByBackend((channel) => forwarded.has(channel));

const RESTART_DELAY_MS = 1_000;
const RESTART_DELAY_MAX_MS = 30_000;
let restartDelay = RESTART_DELAY_MS;

// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a process has none
const send = (message: ToBackend) => backend?.postMessage(message);

export function startBackend(): Promise<void> {
  const child = utilityProcess.fork(path.join(__dirname, "backend.cjs"), [], {
    serviceName: "Otter Backend",
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
  ready = new Promise((resolve) => {
    child.on("message", (message: FromBackend) => {
      if (message.type === "ready") {
        serve(message.channels);
        restartDelay = RESTART_DELAY_MS;
        send({ type: "presence", active: lastPresence });
        resolve();
      } else {
        receive(message);
      }
    });
  });
  child.on("exit", (code) => {
    if (backend === child) backend = null;
    for (const call of invoking.values()) call.reject(new Error("The mail backend stopped."));
    invoking.clear();
    if (stopping) return;
    logger.error("backend", `The mail backend exited (${code}); starting it again`);
    setTimeout(() => void startBackend(), restartDelay);
    restartDelay = Math.min(restartDelay * 2, RESTART_DELAY_MAX_MS);
  });
  return ready;
}

export function stopBackend(): void {
  stopping = true;
  send({ type: "shutdown" });
}

export async function invokeBackend(channel: string, params?: unknown): Promise<unknown> {
  await ready;
  const id = nextInvokeId++;
  const result = new Promise((resolve, reject) => invoking.set(id, { resolve, reject }));
  send({ type: "invoke", id, channel, params });
  return result;
}

function serve(channels: string[]): void {
  for (const channel of channels) {
    if (forwarded.has(channel)) continue;
    forwarded.add(channel);
    ipcMain.handle(channel, (_event, params: unknown) => invokeBackend(channel, params));
  }
}

const IDLE_THRESHOLD_SECONDS = 120;
const PRESENCE_POLL_MS = 15_000;
let screenLocked = false;
let systemSuspended = false;
let lastPresence = false;
let presencePoll: ReturnType<typeof setInterval> | null = null;

function computePresence(): boolean {
  if (screenLocked || systemSuspended) return false;
  try {
    return powerMonitor.getSystemIdleTime() < IDLE_THRESHOLD_SECONDS;
  } catch {
    return false;
  }
}

function updatePresence(): void {
  const next = computePresence();
  if (next === lastPresence) return;
  lastPresence = next;
  send({ type: "presence", active: next });
}

void app.whenReady().then(() => {
  updatePresence();
  presencePoll = setInterval(updatePresence, PRESENCE_POLL_MS);
  powerMonitor.on("suspend", () => {
    systemSuspended = true;
    updatePresence();
  });
  powerMonitor.on("resume", () => {
    systemSuspended = false;
    send({ type: "resume" });
    updatePresence();
  });
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    updatePresence();
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    updatePresence();
  });
  app.on("browser-window-focus", updatePresence);
  app.on("before-quit", () => {
    // Quitting from here on: a backend killed with the app (SIGTERM on logout) isn't a crash.
    stopping = true;
    if (presencePoll) clearInterval(presencePoll);
    presencePoll = null;
  });
});

function receive(message: Exclude<FromBackend, { type: "ready" }>): void {
  if (message.type === "result") {
    const call = invoking.get(message.id);
    invoking.delete(message.id);
    if (message.error !== undefined) call?.reject(new Error(message.error));
    else call?.resolve(message.result);
  } else if (message.type === "request") {
    const { id, kind, params } = message;
    answer(kind, params).then(
      (result) => send({ type: "reply", id, result }),
      (err: unknown) =>
        send({ type: "reply", id, error: err instanceof Error ? err.message : String(err) }),
    );
  } else {
    carryOut(message);
  }
}

async function answer(
  kind: keyof MainRequests,
  params: MainRequests[keyof MainRequests]["params"],
): Promise<unknown> {
  switch (kind) {
    case "seal": {
      const { text } = params as MainRequests["seal"]["params"];
      return safeStorage.encryptString(text).toString("base64");
    }
    case "unseal": {
      const { sealed } = params as MainRequests["unseal"]["params"];
      return safeStorage.decryptString(Buffer.from(sealed, "base64"));
    }
    case "openExternal": {
      await shell.openExternal((params as MainRequests["openExternal"]["params"]).url);
      return;
    }
    case "openFile": {
      const { name, bytes } = params as MainRequests["openFile"]["params"];
      const error = await shell.openPath(await tempFile(name, bytes));
      if (error) throw new Error(error);
      return;
    }
    case "saveFile": {
      const { name, bytes } = params as MainRequests["saveFile"]["params"];
      const result = await dialog.showSaveDialog({ defaultPath: name });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, bytes);
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
  }
}

const MAX_AWAITING_CLICK = 50;
type ShownNotification = { notification: Notification; id?: string; chat?: string };
const notificationsAwaitingClick = new Set<ShownNotification>();

/** The main window's page answers it, as the chat's own controls would; it runs while hidden. */
function sendToWindow(done: { id?: string; chat?: string; action?: string; reply?: string }) {
  getMainWindow()?.webContents.send("notification:action", done);
}

/** Agents get a sound of their own, so you can tell them from mail and the calendar without looking. */
const AGENT_SOUND = "Glass";

const postedAsAgent = new Map<string, { chat: string; actions: string[] }>();
let answeringAgentNotifications = false;

/** An agent's notification from the agent itself (its picture, Messages' layout), where the build can. */
function postAsAgent(
  effect: Extract<MainEffect, { kind: "notify" }> & { agent: { id: string; name: string } },
  chat: string,
): boolean {
  const notifier = hostOS.agentNotifications?.();
  if (!notifier) return false;
  if (!answeringAgentNotifications) {
    answeringAgentNotifications = true;
    notifier.onResponse(({ id, action, reply }) => {
      const posted = postedAsAgent.get(id);
      postedAsAgent.delete(id);
      const chatOf = posted?.chat;
      if (reply !== undefined) return sendToWindow({ id, chat: chatOf, reply });
      if (action !== undefined)
        return sendToWindow({ id, chat: chatOf, action: posted?.actions[action] });
      if (chatOf)
        void focusMainWindow().then((win) => win.webContents.send("agent:openChat", chatOf));
    });
  }
  const id = effect.id ?? crypto.randomUUID();
  const actions = effect.actions ?? [];
  postedAsAgent.set(id, { chat, actions });
  if (postedAsAgent.size > MAX_AWAITING_CLICK)
    postedAsAgent.delete(postedAsAgent.keys().next().value!);
  const image = effect.icon ? nativeImage.createFromDataURL(effect.icon) : undefined;
  notifier
    .post({
      id,
      chat,
      ...(effect.agent.conversation ? { conversation: effect.agent.conversation } : {}),
      ...(effect.body ? { body: effect.body } : {}),
      ...(effect.silent ? { silent: true } : { sound: AGENT_SOUND }),
      ...(actions.length > 0 ? { actions } : {}),
      ...(effect.reply ? { reply: effect.reply } : {}),
      sender: {
        id: effect.agent.id,
        name: effect.agent.name,
        ...(image && !image.isEmpty() ? { image: image.toPNG() } : {}),
        ...(effect.agent.emoji ? { emoji: effect.agent.emoji } : {}),
        ...(effect.agent.mark ? { mark: effect.agent.mark } : {}),
      },
    })
    .catch((error: unknown) => logger.error("notify", "posting as the agent failed", error));
  return true;
}

function carryOut(effect: MainEffect): void {
  switch (effect.kind) {
    case "broadcast":
      broadcast(effect.channel, effect.params);
      return;
    case "notify": {
      const {
        kind: _kind,
        icon: _icon,
        id,
        category,
        silent,
        open,
        chat,
        code,
        actions,
        reply,
        ...options
      } = effect;
      if (effect.agent && chat && postAsAgent({ ...effect, agent: effect.agent }, chat)) return;
      if (!Notification.isSupported()) return;
      const buttons = code ? ["Copy & trash"] : (actions ?? []);
      const notification = new Notification({
        ...options,
        groupId: category,
        ...(category === "agent" && !silent ? { sound: AGENT_SOUND } : {}),
        ...(silent !== undefined ? { silent } : {}),
        ...(buttons.length > 0 && {
          actions: buttons.map((text) => ({ type: "button" as const, text })),
        }),
        ...(reply && { hasReply: true, replyPlaceholder: reply }),
      });
      const shown: ShownNotification = { notification, id, chat };
      notificationsAwaitingClick.add(shown);
      if (notificationsAwaitingClick.size > MAX_AWAITING_CLICK) {
        notificationsAwaitingClick.delete(notificationsAwaitingClick.values().next().value!);
      }
      notification.on("close", () => {
        notificationsAwaitingClick.delete(shown);
      });
      notification.on("click", () => {
        notificationsAwaitingClick.delete(shown);
        if (open) setPendingOpenMessage(open);
        void focusMainWindow().then((win) => {
          if (open) win.webContents.send("mail:open");
          if (chat) win.webContents.send("agent:openChat", chat);
        });
      });
      notification.on("action", ({ actionIndex }) => {
        notificationsAwaitingClick.delete(shown);
        if (!code) return sendToWindow({ id, chat, action: buttons[actionIndex] });
        clipboard.writeText(code);
        if (open) {
          invokeBackend("gmail:trashMessage", open).catch((err: unknown) =>
            logger.warn("notify", "trashing the code's mail failed", String(err)),
          );
        }
      });
      notification.on("reply", ({ reply }) => {
        notificationsAwaitingClick.delete(shown);
        sendToWindow({ id, chat, reply });
      });
      notification.show();
      return;
    }
    case "dismissNotification": {
      for (const [id, posted] of postedAsAgent) {
        if ((effect.id && id === effect.id) || (effect.chat && posted.chat === effect.chat)) {
          postedAsAgent.delete(id);
          hostOS.agentNotifications?.()?.remove([id]);
        }
      }
      for (const shown of notificationsAwaitingClick) {
        if ((effect.id && shown.id === effect.id) || (effect.chat && shown.chat === effect.chat)) {
          notificationsAwaitingClick.delete(shown);
          shown.notification.close();
        }
      }
      return;
    }
    case "unread":
      unreadCount = effect.count;
      showDockBadge();
      return;
    case "settings":
      applySettings(effect.settings, effect.patch);
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
  const file = path.join(app.getPath("temp"), "otter-files", key, sanitizeFilename(name));
  const existing = await fs.stat(file).catch(() => null);
  if (!existing || existing.size !== bytes.length) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, file);
  }
  return file;
}
