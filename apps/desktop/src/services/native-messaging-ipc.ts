import {
  app,
  ipcMain,
  type IpcMainInvokeEvent,
  type IpcMainServiceWorkerInvokeEvent,
  type ServiceWorkerMain,
  type Session,
  type WebContents,
  type WebFrameMain,
} from "electron";

import { connectNativeHost, type NativePort } from "./native-messaging.js";

type Owner = ServiceWorkerMain | WebFrameMain;
type Connection = { extensionId: string; port?: NativePort; release(): void };
type Profile = { directories: string[]; owners: Map<Owner, Map<string, Connection>> };
type CallEvent = IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent;
const profiles = new Map<Session, Profile>();
const watchedPages = new WeakSet<WebContents>();
let wired = false;

function disconnectOwner(profile: Profile, owner: Owner): void {
  const ports = profile.owners.get(owner);
  profile.owners.delete(owner);
  for (const [id, connection] of ports ?? []) {
    ports!.delete(id);
    connection.port?.disconnect();
    connection.release();
  }
}

async function call(event: CallEvent, extensionId: unknown, method: unknown, args: unknown) {
  const worker = event.type === "service-worker" ? event.serviceWorker : null;
  const frame = event.type === "frame" ? event.senderFrame : null;
  const session = event.type === "service-worker" ? event.session : event.sender.session;
  const profile = profiles.get(session);
  const owner = worker ?? frame;
  const url = worker?.scope ?? frame?.url;
  const extension =
    typeof extensionId === "string" ? session.extensions.getExtension(extensionId) : null;
  if (
    !profile ||
    !owner ||
    owner.isDestroyed() ||
    !extension ||
    !url?.startsWith(`chrome-extension://${extension.id}/`)
  ) {
    throw new Error("Not an extension of this browser.");
  }
  const permissions = (extension.manifest as { permissions?: string[] }).permissions;
  if (!permissions?.includes("nativeMessaging"))
    throw new Error("The nativeMessaging permission is required.");
  if (
    !Array.isArray(args) ||
    typeof args[0] !== "string" ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(args[0])
  ) {
    throw new Error("Invalid native messaging port.");
  }
  const [id, value] = args as [string, unknown];
  let ports = profile.owners.get(owner);
  if (method === "connect") {
    if (typeof value !== "string") throw new Error("Invalid native messaging host name specified.");
    if (ports?.has(id)) throw new Error("Native messaging port already exists.");
    if (!ports) {
      ports = new Map();
      profile.owners.set(owner, ports);
    }
    if (frame && event.type === "frame" && !watchedPages.has(event.sender)) {
      const contents = event.sender;
      watchedPages.add(contents);
      const closePage = () => {
        for (const each of profile.owners.keys()) {
          if (
            "frameTreeNodeId" in each &&
            (each.isDestroyed() || each.top === contents.mainFrame)
          ) {
            disconnectOwner(profile, each);
          }
        }
      };
      contents.on("render-process-gone", closePage);
      contents.once("destroyed", () => {
        for (const each of profile.owners.keys()) {
          if ("frameTreeNodeId" in each && each.isDestroyed()) disconnectOwner(profile, each);
        }
      });
      contents.on("did-start-navigation", (details) => {
        if (details.isSameDocument) return;
        for (const each of profile.owners.keys()) {
          if (
            "frameTreeNodeId" in each &&
            each.frameTreeNodeId === details.frame?.frameTreeNodeId
          ) {
            disconnectOwner(profile, each);
          }
        }
      });
    }
    const task = worker?.startTask();
    const connections = ports;
    const connection: Connection = { extensionId: extension.id, release: () => task?.end() };
    connections.set(id, connection);
    const send = (kind: string, payload?: unknown) => {
      if (owner.isDestroyed() || ("detached" in owner && owner.detached)) {
        disconnectOwner(profile, owner);
        return;
      }
      try {
        owner.send("crx:nativeEvent", id, kind, payload);
      } catch {
        disconnectOwner(profile, owner);
      }
    };
    const close = (error?: string) => {
      if (connections.get(id) !== connection) return;
      connections.delete(id);
      if (connections.size === 0) profile.owners.delete(owner);
      connection.release();
      send("disconnect", error);
    };
    try {
      const port = await connectNativeHost(
        profile.directories,
        value,
        extension.id,
        (message) => send("message", message),
        close,
      );
      if (connections.get(id) !== connection) port.disconnect();
      else connection.port = port;
    } catch (error) {
      close(
        error instanceof Error ? error.message : "Couldn't connect to the native messaging host.",
      );
    }
    return;
  }
  const connection = ports?.get(id);
  if (!connection || connection.extensionId !== extension.id)
    throw new Error("Attempting to use a disconnected port object.");
  if (method === "postMessage") {
    if (!connection.port) throw new Error("Native messaging port is still connecting.");
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Chrome's native Port has no target origin argument.
    connection.port.postMessage(value);
  } else if (method === "disconnect") {
    if (connection.port) connection.port.disconnect();
    else {
      ports!.delete(id);
      if (ports!.size === 0) profile.owners.delete(owner);
      connection.release();
    }
  } else throw new Error("Unknown native messaging method.");
}

export function enableNativeMessaging(session: Session, directories: string[]): void {
  if (profiles.has(session)) return;
  const profile: Profile = { directories, owners: new Map() };
  profiles.set(session, profile);
  if (!wired) {
    wired = true;
    ipcMain.handle("crx:nativeCall", (event, ...args) =>
      call(event as CallEvent, ...(args as [unknown, unknown, unknown])),
    );
    app.on("will-quit", () => {
      for (const each of profiles.values()) {
        for (const owner of each.owners.keys()) disconnectOwner(each, owner);
      }
    });
  }
  const workers = new Map<number, ServiceWorkerMain>();
  session.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
    if (runningStatus === "stopped") {
      const worker = workers.get(versionId);
      if (worker) disconnectOwner(profile, worker);
      workers.delete(versionId);
      return;
    }
    if ((runningStatus !== "starting" && runningStatus !== "running") || workers.has(versionId))
      return;
    const worker = session.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!worker || !worker.scope.startsWith("chrome-extension://")) return;
    workers.set(versionId, worker);
    worker.ipc.handle("crx:nativeCall", (event, ...args) =>
      call(event, ...(args as [unknown, unknown, unknown])),
    );
  });
  session.extensions.on("extension-unloaded", (_event, extension) => {
    for (const [owner, ports] of profile.owners) {
      for (const connection of ports.values()) {
        if (connection.extensionId === extension.id) {
          disconnectOwner(profile, owner);
          break;
        }
      }
    }
  });
}
