import { afterEach, expect, it, vi } from "vite-plus/test";

import { installNativeMessaging } from "./native-messaging.ts";

type Event<Args extends unknown[]> = {
  addListener(listener: (...args: Args) => void): void;
  removeListener(listener: (...args: Args) => void): void;
};
type Port = {
  onMessage: Event<[unknown, Port]>;
  onDisconnect: Event<[Port]>;
  postMessage(message: unknown): void;
  disconnect(): void;
};
type Runtime = {
  lastError?: { message: string };
  connectNative(name: string): Port;
  sendNativeMessage(
    name: string,
    message: unknown,
    callback?: (response?: unknown) => void,
  ): Promise<unknown> | undefined;
};

afterEach(() => vi.unstubAllGlobals());

function setup(
  call: (method: string, args: unknown[]) => Promise<unknown> = async () => undefined,
) {
  const listeners = new Map<string, (kind: string, payload: unknown) => void>();
  const runtime = {} as Runtime;
  const browserRuntime = {} as Runtime;
  vi.stubGlobal("chrome", { runtime });
  vi.stubGlobal("browser", { runtime: browserRuntime });
  const bridge = {
    call: vi.fn(call),
    listen: (id: string, listener: (kind: string, payload: unknown) => void) => {
      listeners.set(id, listener);
    },
    forget: (id: string) => {
      listeners.delete(id);
    },
  };
  installNativeMessaging(bridge);
  const deliver = (kind: string, value: unknown) => {
    const listener = listeners.values().next().value;
    if (!listener) throw new Error("No native port is listening.");
    listener(kind, value);
  };
  return { runtime, browserRuntime, bridge, listeners, deliver };
}

it("returns a port synchronously and queues writes until the host connects", async () => {
  let open!: () => void;
  const opening = new Promise<void>((resolve) => {
    open = resolve;
  });
  let sent!: () => void;
  const sending = new Promise<void>((resolve) => {
    sent = resolve;
  });
  const { runtime, bridge } = setup(async (method) => {
    if (method === "connect") await opening;
    if (method === "postMessage") sent();
  });
  const port = runtime.connectNative("com.otter.test");
  port.postMessage({ text: "🔑" });
  expect(bridge.call.mock.calls.map(([method]) => method)).toEqual(["connect"]);
  open();
  await sending;
  expect(bridge.call.mock.calls[1]?.[1][1]).toEqual({ text: "🔑" });
});

it("delivers messages only to the owning port, removes listeners, and scopes lastError to disconnect", () => {
  const { runtime, browserRuntime, listeners, deliver } = setup();
  const first = runtime.connectNative("com.otter.test");
  const second = browserRuntime.connectNative("com.otter.test");
  const message = vi.fn();
  const other = vi.fn();
  first.onMessage.addListener(message);
  second.onMessage.addListener(other);
  deliver("message", { value: 42 });
  expect(message).toHaveBeenCalledWith({ value: 42 }, first);
  expect(other).not.toHaveBeenCalled();
  first.onMessage.removeListener(message);
  deliver("message", { value: 43 });
  expect(message).toHaveBeenCalledTimes(1);
  let observed: unknown;
  first.onDisconnect.addListener((port) => {
    expect(port).toBe(first);
    observed = [runtime.lastError?.message, browserRuntime.lastError?.message];
  });
  deliver("disconnect", "Access to the native messaging host is forbidden.");
  expect(observed).toEqual([
    "Access to the native messaging host is forbidden.",
    "Access to the native messaging host is forbidden.",
  ]);
  expect(runtime.lastError).toBeUndefined();
  expect(listeners.size).toBe(1);
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- This is a Chrome extension Port.
  expect(() => first.postMessage({})).toThrow("disconnected port");
  second.disconnect();
  expect(listeners.size).toBe(0);
});

it("resolves one-shot messages with the first response and closes their port", async () => {
  const { runtime, listeners, deliver } = setup();
  const result = runtime.sendNativeMessage("com.otter.test", { request: true });
  deliver("message", { response: true });
  expect(await result).toEqual({ response: true });
  expect(listeners.size).toBe(0);
});

it("reports one-shot failures as a rejected promise or callback lastError", async () => {
  const { runtime, deliver } = setup();
  const result = runtime.sendNativeMessage("com.otter.test", {});
  deliver("disconnect", "Specified native messaging host not found.");
  await expect(result).rejects.toThrow("host not found");
  let completed!: () => void;
  const done = new Promise<void>((resolve) => {
    completed = resolve;
  });
  let observed: unknown;
  expect(
    runtime.sendNativeMessage("com.otter.test", {}, (response) => {
      observed = [response, runtime.lastError?.message];
      completed();
    }),
  ).toBeUndefined();
  deliver("disconnect", "Specified native messaging host not found.");
  await done;
  expect(observed).toEqual([undefined, "Specified native messaging host not found."]);
  expect(runtime.lastError).toBeUndefined();
});

it("disconnects a port when its connection request fails", async () => {
  const { runtime, listeners } = setup(async () => {
    throw new Error("The nativeMessaging permission is required.");
  });
  const port = runtime.connectNative("com.otter.test");
  const error = await new Promise<string | undefined>((resolve) => {
    port.onDisconnect.addListener(() => resolve(runtime.lastError?.message));
  });
  expect(error).toContain("nativeMessaging permission");
  expect(listeners.size).toBe(0);
});

it("closes the native host when a queued write fails", async () => {
  let closed!: () => void;
  const closing = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const { runtime, listeners } = setup(async (method) => {
    if (method === "postMessage") throw new Error("Native messaging message is too large.");
    if (method === "disconnect") closed();
  });
  const port = runtime.connectNative("com.otter.test");
  const disconnected = new Promise<string | undefined>((resolve) => {
    port.onDisconnect.addListener(() => resolve(runtime.lastError?.message));
  });
  port.postMessage({});
  expect(await disconnected).toContain("too large");
  await closing;
  expect(listeners.size).toBe(0);
});

it("rejects non-JSON messages synchronously and suppresses local disconnect events", () => {
  const { runtime } = setup();
  const port = runtime.connectNative("com.otter.test");
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(() => port.postMessage(circular)).toThrow();
  expect(() => port.postMessage(undefined)).toThrow("JSON serializable");
  const disconnected = vi.fn();
  port.onDisconnect.addListener(disconnected);
  port.disconnect();
  port.disconnect();
  expect(disconnected).not.toHaveBeenCalled();
});
