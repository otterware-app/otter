import type { RelayEvent, WatchingMessage } from "@otter/contracts/relay";

import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { getOtterUser, getSessionToken } from "./otter-account.js";

export type RealtimeState = "off" | "connecting" | "live";

export type RealtimeHandlers = {
  onConnected: () => void;
  onEvent: (event: RelayEvent) => void;
  onStateChange: (state: RealtimeState) => void;
  /**
   * A connection failed before it opened: offline, or the relay refused the
   * session (the upgrade doesn't say which). Worth checking the session.
   */
  onRefused: () => void;
};

const PING_EVERY_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

let handlers: RealtimeHandlers | null = null;
let stopWatchingResume: (() => void) | null = null;
let socket: WebSocket | null = null;
let state: RealtimeState = "off";
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;

/** The agent session each of this device's windows has on screen, while that window is in front. */
const watching = new Map<string, string>();

function sayWatching(): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const [session = null] = watching.values();
  socket.send(JSON.stringify({ type: "watching", session } satisfies WatchingMessage));
}

/**
 * A window shows an agent's chat and has focus, or no longer does: the relay doesn't push to the
 * account's iPhones about a chat someone is looking at.
 */
export function setWatching(window: string, session: string | null): void {
  const [before = null] = watching.values();
  if (session) watching.set(window, session);
  else watching.delete(window);
  const [now = null] = watching.values();
  if (now !== before) sayWatching();
}

function setState(next: RealtimeState): void {
  if (next === state) return;
  state = next;
  handlers?.onStateChange(next);
}

export function getRealtimeState(): RealtimeState {
  return state;
}

function clearTimers(): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (pongTimer) clearTimeout(pongTimer);
  retryTimer = pingTimer = pongTimer = null;
}

function dropSocket(): void {
  const current = socket;
  socket = null;
  clearTimers();
  if (current && current.readyState <= WebSocket.OPEN) current.close(1000);
}

function scheduleReconnect(): void {
  if (!handlers || retryTimer) return;
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  attempt += 1;
  // A little jitter, so Macs knocked off together don't come back together.
  retryTimer = setTimeout(connect, delay * (0.8 + Math.random() * 0.4));
}

function connect(): void {
  retryTimer = null;
  if (!handlers || !getOtterUser()) return;
  dropSocket();
  setState("connecting");

  // The desktop authenticates with its bearer token (Node's WebSocket takes
  // request headers; the DOM typings don't know); a browser sends its cookie.
  const url = `${platform().relayUrl.replace(/^http/, "ws")}/v1/events`;
  const token = getSessionToken();
  const ws = token
    ? new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } } as unknown as string[])
    : new WebSocket(url);
  socket = ws;
  let opened = false;

  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    opened = true;
    attempt = 0;
    setState("live");
    sayWatching();
    pingTimer = setInterval(() => {
      ws.send("ping");
      // Said again while it's true: the relay forgets a device that stops saying it.
      if (watching.size > 0) sayWatching();
      pongTimer ??= setTimeout(() => {
        logger.info("realtime", "No pong; reconnecting");
        dropSocket();
        setState("connecting");
        scheduleReconnect();
      }, PONG_TIMEOUT_MS);
    }, PING_EVERY_MS);
    handlers?.onConnected();
  });

  ws.addEventListener("message", (message) => {
    if (socket !== ws) return;
    const text = String(message.data);
    if (text === "pong") {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
      return;
    }
    try {
      handlers?.onEvent(JSON.parse(text) as RelayEvent);
    } catch (err) {
      logger.failure("realtime", "Bad event", err);
    }
  });

  ws.addEventListener("close", (event) => {
    if (socket !== ws) return;
    socket = null;
    clearTimers();
    logger.info("realtime", "Disconnected", { code: event.code });
    setState("connecting");
    scheduleReconnect();
    if (!opened) handlers?.onRefused();
  });
}

function reconnectNow(): void {
  if (!handlers) return;
  attempt = 0;
  dropSocket();
  connect();
}

export function startRealtime(next: RealtimeHandlers): void {
  const first = handlers === null;
  handlers = next;
  if (first) {
    // After sleep the old socket is usually dead; don't wait for the ping to notice.
    stopWatchingResume = platform().onResume(reconnectNow);
  }
  reconnectNow();
}

export function stopRealtime(): void {
  if (!handlers) return;
  stopWatchingResume?.();
  stopWatchingResume = null;
  dropSocket();
  attempt = 0;
  setState("off");
  handlers = null;
}
