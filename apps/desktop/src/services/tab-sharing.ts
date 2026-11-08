import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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

/** Where the field being typed in is, in the page's CSS px. */
const FOCUSED_FIELD = `(() => {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`;
/** A world of its own, where the page can't see or stop it. */
const OVERLAY_WORLD = 1_000;
const lastTyped = new WeakMap<WebContents, number>();

/** Tells the tab's window what the agent's doing, so it draws the agent's pointer over the page. */
function showAgentInput(page: WebContents, method: unknown, params: unknown): void {
  const host = page.hostWebContents;
  if (!host || host.isDestroyed()) return;
  const p = (params ?? {}) as { type?: string; x?: number; y?: number };
  if (method === "Input.dispatchMouseEvent" && typeof p.x === "number" && typeof p.y === "number") {
    if (p.type === "mouseReleased") return;
    host.send("browser:agentPointer", {
      webContentsId: page.id,
      x: p.x,
      y: p.y,
      click: p.type === "mousePressed",
    });
  } else if (method === "Input.insertText" || method === "Input.dispatchKeyEvent") {
    const now = Date.now();
    if (now - (lastTyped.get(page) ?? 0) < 150) return;
    lastTyped.set(page, now);
    void page
      .executeJavaScriptInIsolatedWorld(OVERLAY_WORLD, [{ code: FOCUSED_FIELD }])
      .then((field: unknown) => {
        if (field && !host.isDestroyed())
          host.send("browser:agentTyping", { webContentsId: page.id, ...(field as object) });
      })
      .catch(() => {});
  }
}

/**
 * Electron's debugger can't return a deeply nested value (its CBOR to JSON conversion has a stack
 * limit): a large page's accessibility snapshot never comes back. A call that wants its result by
 * value returns it as a JSON string instead, parsed back here.
 */
export function flattened(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (method !== "Runtime.callFunctionOn" || params.returnByValue !== true || !params.awaitPromise)
    return null;
  return {
    ...params,
    functionDeclaration: `async function (...args) { return JSON.stringify(await (${String(params.functionDeclaration)}).apply(this, args)); }`,
  };
}

export function unflattened(response: { result?: { type?: string; value?: unknown } } | undefined) {
  const result = response?.result;
  if (result?.type !== "string" || typeof result.value !== "string") return response ?? {};
  const value: unknown = JSON.parse(result.value);
  const type = value === null || Array.isArray(value) ? "object" : typeof value;
  const subtype =
    value === null ? { subtype: "null" } : Array.isArray(value) ? { subtype: "array" } : {};
  return { ...response, result: { type, ...subtype, value } };
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
      if (message.sessionId === undefined) showAgentInput(page, message.method, message.params);
      const params = (message.params as Record<string, unknown> | undefined) ?? {};
      const flat = flattened(String(message.method), params);
      const result = (await page.debugger.sendCommand(
        String(message.method),
        flat ?? params,
        typeof message.sessionId === "string" ? message.sessionId : undefined,
      )) as { result?: { type?: string; value?: unknown } } | undefined;
      return flat ? unflattened(result) : (result ?? {});
    }
    case "activateTab":
    case "closeTab": {
      const page = pageOf(message.tabId);
      const channel = message.type === "closeTab" ? "browser:closeTab" : "browser:selectTab";
      page.hostWebContents?.send(channel, { webContentsId: page.id });
      return {};
    }
    case "createTab": {
      const page = await openTab(typeof message.url === "string" ? message.url : "about:blank");
      return { tabId: page.id, targetId: await attach(page) };
    }
    default:
      throw new Error(`Otter doesn't know the relay command ${String(message.type)}.`);
  }
}

const opening = new Map<string, (page: WebContents) => void>();
const OPEN_TIMEOUT_MS = 20_000;

/** A tab the agent opens: in Otter's browser beside the tabs it was given, shared as they are. */
function openTab(url: string): Promise<WebContents> {
  const host = [...shared.values()].find((page) => !page.isDestroyed())?.hostWebContents;
  if (!host) return Promise.reject(new Error("Otter has no window to open the tab in."));
  const request = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      opening.delete(request);
      reject(new Error("Otter didn't open the tab in time."));
    }, OPEN_TIMEOUT_MS);
    opening.set(request, (page) => {
      clearTimeout(timer);
      resolve(page);
    });
    host.send("browser:openTab", { url, share: request });
  });
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
export async function shareTab(page: WebContents, share: boolean, request?: string): Promise<void> {
  if (!share) {
    if (!shared.delete(page.id)) return;
    detach(page);
    if (!page.isDestroyed()) page.setBackgroundThrottling(true);
    if (shared.size === 0) stop();
    else {
      syncTabs();
      setStatus(status);
    }
    return;
  }
  shared.set(page.id, page);
  // The agent works in it while it's off screen too: a throttled page stalls its every read.
  page.setBackgroundThrottling(false);
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
  } else {
    try {
      await connect();
    } catch (error) {
      shared.delete(page.id);
      if (shared.size === 0) stop();
      throw error;
    }
  }
  if (request) {
    opening.get(request)?.(page);
    opening.delete(request);
  }
}

export const sharingStatus = () => ({ status, shared: [...shared.keys()] });
