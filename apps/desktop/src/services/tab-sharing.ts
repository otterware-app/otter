import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { app, type WebContents } from "electron";

import { invokeBackend } from "../backend-host.js";
import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { getBrowserSession } from "./browser.js";
import { activeTab } from "./extensions.js";

const PROTOCOL = "openclaw-extension-relay.v2";
const AUTH_LABEL = "openclaw.browser-relay.auth";
const AUTH_VERSION = 2;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_SKEW_MS = 30_000;

export type SharingStatus = "off" | "connecting" | "on" | "offline";

type Relay = { url: string; key: string };
type Fields = Record<(typeof FIELDS)[number], string | number>;

const FIELDS = [
  "keyId",
  "instanceId",
  "sessionId",
  "clientNonce",
  "serverNonce",
  "issuedAtMs",
  "expiresAtMs",
  "role",
  "transport",
  "method",
  "resource",
  "flow",
] as const;

const shared = new Map<number, WebContents>();
const watched = new WeakSet<WebContents>();
const attached = new Set<number>();
let socket: WebSocket | null = null;
let authenticated = false;
let connected: Promise<void> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let status: SharingStatus = "off";

function setStatus(next: SharingStatus, error?: string): void {
  status = next;
  broadcast("browser:sharing", { status, shared: [...shared.keys()], error });
}

function proof(key: Buffer, kind: "server" | "client" | "accept", fields: Fields, client = "") {
  const values = [AUTH_LABEL, AUTH_VERSION, kind, ...FIELDS.map((name) => fields[name])];
  if (kind === "accept") values.push(client);
  return createHmac("sha256", key).update(JSON.stringify(values)).digest("base64url");
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The client half of Browser Relay Authentication v2: hello, the server's proof, then ours. */
function authClient(relay: Relay) {
  const key = Buffer.from(relay.key, "hex");
  const keyId = createHash("sha256").update(key).digest("base64url").slice(0, 22);
  const clientNonce = randomBytes(32).toString("base64url");
  const { pathname, searchParams } = new URL(relay.url);
  searchParams.sort();
  const resource = `${pathname}${searchParams.size ? `?${searchParams}` : ""}`;
  let challenge: Fields | null = null;
  let clientProof = "";
  return {
    hello: { type: "auth.hello", v: AUTH_VERSION, keyId, clientNonce },
    answer(message: Record<string, unknown>) {
      const fields = Object.fromEntries(FIELDS.map((name) => [name, message[name]])) as Fields;
      const issued = Number(fields.issuedAtMs);
      if (
        message.v !== AUTH_VERSION ||
        fields.keyId !== keyId ||
        fields.clientNonce !== clientNonce ||
        fields.role !== "extension" ||
        fields.transport !== "websocket" ||
        fields.method !== "GET" ||
        fields.resource !== resource ||
        fields.flow !== "extension" ||
        Math.abs(Date.now() - issued) > MAX_SKEW_MS ||
        Date.now() > Number(fields.expiresAtMs) ||
        !same(String(message.serverProof), proof(key, "server", fields))
      )
        throw new Error("The gateway's browser relay didn't prove it holds the key.");
      challenge = fields;
      clientProof = proof(key, "client", fields);
      return { type: "auth.response", v: AUTH_VERSION, sessionId: fields.sessionId, clientProof };
    },
    accept(message: Record<string, unknown>) {
      if (
        !challenge ||
        message.sessionId !== challenge.sessionId ||
        !same(String(message.acceptProof), proof(key, "accept", challenge, clientProof))
      )
        throw new Error("The gateway's browser relay didn't accept Otter.");
    },
  };
}

function send(message: Record<string, unknown>): void {
  if (authenticated && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function tabsInfo() {
  const active = activeTab();
  return [...shared.values()]
    .filter((page) => !page.isDestroyed())
    .map((page) => ({
      tabId: page.id,
      url: page.getURL(),
      title: page.getTitle(),
      active: page.id === active,
    }));
}

const syncTabs = () => send({ type: "tabs", tabs: tabsInfo() });

function pageOf(tabId: unknown): WebContents {
  const page = typeof tabId === "number" ? shared.get(tabId) : undefined;
  if (!page || page.isDestroyed()) throw new Error(`Tab ${String(tabId)} isn't shared with you.`);
  return page;
}

async function attach(page: WebContents): Promise<string> {
  if (!page.debugger.isAttached()) {
    page.debugger.attach("1.3");
    attached.add(page.id);
    const tabId = page.id;
    const onMessage = (
      _event: unknown,
      method: string,
      params: unknown,
      sessionId: string | undefined,
    ) => send({ type: "cdpEvent", tabId, ...(sessionId ? { sessionId } : {}), method, params });
    const onDetach = (_event: unknown, reason: string) => {
      page.debugger.off("message", onMessage);
      attached.delete(tabId);
      send({ type: "detached", tabId, reason });
    };
    page.debugger.on("message", onMessage);
    page.debugger.once("detach", onDetach);
  }
  const { targetInfo } = (await page.debugger.sendCommand("Target.getTargetInfo")) as {
    targetInfo: { targetId: string };
  };
  return targetInfo.targetId;
}

function detach(page: WebContents): void {
  if (attached.has(page.id) && !page.isDestroyed() && page.debugger.isAttached())
    page.debugger.detach();
  attached.delete(page.id);
}

async function command(message: Record<string, unknown>): Promise<unknown> {
  switch (message.type) {
    case "attach":
      return { targetId: await attach(pageOf(message.tabId)) };
    case "detach":
      detach(pageOf(message.tabId));
      return {};
    case "cdp": {
      const page = pageOf(message.tabId);
      const result = await page.debugger.sendCommand(
        String(message.method),
        (message.params as object | undefined) ?? {},
        typeof message.sessionId === "string" ? message.sessionId : undefined,
      );
      return result ?? {};
    }
    case "activateTab":
    case "closeTab": {
      const page = pageOf(message.tabId);
      const channel = message.type === "closeTab" ? "browser:closeTab" : "browser:selectTab";
      page.hostWebContents?.send(channel, { webContentsId: page.id });
      return {};
    }
    case "createTab":
      throw new Error(
        "Otter only gives you the tabs the user shares. Work in one of those: navigate it instead of opening a new tab.",
      );
    default:
      throw new Error(`Otter doesn't know the relay command ${String(message.type)}.`);
  }
}

function onCommand(message: Record<string, unknown>): void {
  if (message.type === "ping") {
    send({ type: "pong" });
    return;
  }
  const { seq } = message;
  command(message).then(
    (result) => send({ type: "result", seq, result }),
    (error: unknown) =>
      send({
        type: "error",
        seq,
        message: error instanceof Error ? error.message : String(error),
      }),
  );
}

function reconnect(error: string): void {
  setStatus("offline", error);
  if (retry) clearTimeout(retry);
  retry = setTimeout(
    () => {
      retry = null;
      if (shared.size > 0) connect().catch(() => {});
    },
    Math.min(1000 * 2 ** attempt++, 30_000),
  );
}

function connect(): Promise<void> {
  connected ??= new Promise<void>((resolve, reject) => {
    setStatus("connecting");
    void (async () => {
      const relay = (await invokeBackend("agent:openClawBrowserRelay")) as Relay;
      if (shared.size === 0) throw new Error("Nothing is shared anymore.");
      const auth = authClient(relay);
      const ws = new WebSocket(relay.url, [PROTOCOL]);
      socket = ws;
      const timeout = setTimeout(() => ws.close(4001, "authentication timed out"), AUTH_TIMEOUT_MS);
      let failure = "Couldn't reach your gateway's browser relay.";
      ws.addEventListener("open", () => ws.send(JSON.stringify(auth.hello)));
      ws.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (authenticated) onCommand(message);
          else if (message.type === "auth.challenge") ws.send(JSON.stringify(auth.answer(message)));
          else if (message.type === "auth.ok") {
            auth.accept(message);
            clearTimeout(timeout);
            authenticated = true;
            attempt = 0;
            send({
              type: "hello",
              userAgent: getBrowserSession().getUserAgent(),
              browserVersion: `Chrome/${process.versions.chrome}`,
              extensionVersion: app.getVersion(),
              tabs: tabsInfo(),
            });
            setStatus("on");
            logger.info("browser", "Sharing tabs with OpenClaw", { tabs: shared.size });
            resolve();
          } else throw new Error("The gateway's browser relay answered out of turn.");
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          ws.close(4001, failure.slice(0, 120));
        }
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(timeout);
        if (socket !== ws) return;
        const was = authenticated;
        socket = null;
        authenticated = false;
        connected = null;
        for (const tabId of attached) {
          const page = shared.get(tabId);
          if (page) detach(page);
        }
        if (!was) reject(new Error(event.reason || failure));
        if (shared.size === 0) {
          setStatus("off");
          return;
        }
        logger.warn("browser", "Tab sharing connection closed", { code: event.code });
        reconnect(event.reason || failure);
      });
    })().catch((error: unknown) => {
      connected = null;
      const message = error instanceof Error ? error.message : String(error);
      if (shared.size) reconnect(message);
      else setStatus("off");
      reject(new Error(message));
    });
  });
  return connected;
}

function stop(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  attempt = 0;
  const ws = socket;
  socket = null;
  authenticated = false;
  connected = null;
  ws?.close(1000, "nothing shared");
  setStatus("off");
}

/**
 * Shares `page` with OpenClaw, or stops; resolves once the gateway has it. Otter joins the
 * gateway's extension relay as OpenClaw's Chrome extension does (its relay protocol, Browser
 * Relay Authentication v2), with `webContents.debugger` for `chrome.debugger`, so the agent's
 * own browser tool works in the tab.
 */
export async function shareTab(page: WebContents, share: boolean): Promise<void> {
  if (!share) {
    if (!shared.delete(page.id)) return;
    detach(page);
    if (shared.size === 0) stop();
    else {
      syncTabs();
      setStatus(status);
    }
    return;
  }
  shared.set(page.id, page);
  if (!watched.has(page)) {
    watched.add(page);
    page.on("did-navigate", syncTabs);
    page.on("did-navigate-in-page", syncTabs);
    page.on("page-title-updated", syncTabs);
    page.once("destroyed", () => {
      shared.delete(page.id);
      attached.delete(page.id);
      if (shared.size === 0) stop();
      else syncTabs();
    });
  }
  if (authenticated) {
    syncTabs();
    setStatus("on");
    return;
  }
  try {
    await connect();
  } catch (error) {
    shared.delete(page.id);
    if (shared.size === 0) stop();
    throw error;
  }
}

export const sharingStatus = () => ({ status, shared: [...shared.keys()] });
