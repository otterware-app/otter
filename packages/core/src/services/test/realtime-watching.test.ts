import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeSocket.all.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }

  receive(data: string): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }
}

let presenceListener: ((active: boolean) => void) | null = null;
let platformKind: "desktop" | "web" = "desktop";

vi.mock("../otter-account.ts", () => ({
  getOtterUser: () => ({ id: "user" }),
  getSessionToken: () => "token",
}));
vi.mock("../../platform.ts", () => ({
  platform: () => ({
    kind: platformKind,
    relayUrl: "http://relay.test",
    onResume: () => () => {},
    onPresence: (listener: (active: boolean) => void) => {
      presenceListener = listener;
      return () => {
        presenceListener = null;
      };
    },
  }),
}));

const watching = (session: string | null, active = false, device = "desktop") =>
  JSON.stringify({ type: "watching", session, active, device });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  presenceListener = null;
  platformKind = "desktop";
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("tells the relay the agent session a focused window shows, desktop activity, sent origin, and resolved asks", async () => {
  const {
    noteAgentResolved,
    noteAgentSent,
    setWatching,
    setWindowPresence,
    startRealtime,
    stopRealtime,
  } = await import("../realtime.ts");
  startRealtime({ onConnected() {}, onEvent() {}, onStateChange() {}, onRefused() {} });
  const socket = FakeSocket.all.at(-1)!;

  // Looked at before the socket is up: said once it is.
  setWatching("window-a", "agent:main:otter-mail:1");
  expect(socket.sent).toEqual([]);
  socket.open();
  expect(socket.sent).toEqual([watching("agent:main:otter-mail:1")]);

  // Another window losing focus doesn't take the first one's chat away.
  setWatching("window-b", null);
  expect(socket.sent).toHaveLength(1);

  vi.advanceTimersByTime(30_000);
  expect(socket.sent.slice(1)).toEqual(["ping", watching("agent:main:otter-mail:1")]);
  socket.receive("pong");

  // User switches away from the chat but stays active on the computer.
  presenceListener?.(true);
  setWatching("window-a", null);
  expect(socket.sent.at(-1)).toBe(watching(null, true));

  // Sending a message reports the device origin with timestamp; resolving reports ask id.
  noteAgentSent("agent:main:otter-mail:1");
  expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
    type: "sent",
    session: "agent:main:otter-mail:1",
    device: "desktop",
    at: expect.any(Number),
  });
  noteAgentResolved("agent:main:otter-mail:1", "question:q-1");
  expect(socket.sent.at(-1)).toBe(
    JSON.stringify({ type: "resolved", session: "agent:main:otter-mail:1", id: "question:q-1" }),
  );

  // Still active on desktop: keep heartbeat alive.
  vi.advanceTimersByTime(30_000);
  expect(socket.sent.slice(-2)).toEqual(["ping", watching(null, true)]);
  socket.receive("pong");

  // Going idle stops waking the DO beyond bare ping.
  presenceListener?.(false);
  expect(socket.sent.at(-1)).toBe(watching(null, false));
  vi.advanceTimersByTime(30_000);
  expect(socket.sent.slice(-2)).toEqual([watching(null, false), "ping"]);
  socket.receive("pong");

  // A web tab that stops refreshing presence expires after WATCHING_FOR_MS, tells the relay inactive once, then sends bare pings.
  setWindowPresence("tab-1", true);
  expect(socket.sent.at(-1)).toBe(watching(null, true));
  vi.advanceTimersByTime(30_000);
  socket.receive("pong");
  expect(socket.sent.at(-1)).toBe(watching(null, true));
  vi.advanceTimersByTime(30_000);
  socket.receive("pong");
  expect(socket.sent.at(-1)).toBe(watching(null, true));
  vi.advanceTimersByTime(30_000);
  socket.receive("pong");
  expect(socket.sent.at(-1)).toBe(watching(null, false));
  vi.advanceTimersByTime(30_000);
  socket.receive("pong");
  expect(socket.sent.at(-1)).toBe("ping");
  stopRealtime();
});
