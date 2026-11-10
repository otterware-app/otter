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

vi.mock("../otter-account.ts", () => ({
  getOtterUser: () => ({ id: "user" }),
  getSessionToken: () => "token",
}));
vi.mock("../../platform.ts", () => ({
  platform: () => ({ relayUrl: "http://relay.test", onResume: () => () => {} }),
}));

const watching = (session: string | null) => JSON.stringify({ type: "watching", session });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("tells the relay the agent session a focused window shows, and says it again while it does", async () => {
  const { setWatching, startRealtime, stopRealtime } = await import("../realtime.ts");
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

  setWatching("window-a", null);
  expect(socket.sent.at(-1)).toBe(watching(null));
  vi.advanceTimersByTime(30_000);
  // Nothing on screen: the ping alone.
  expect(socket.sent.slice(-2)).toEqual([watching(null), "ping"]);
  stopRealtime();
});
