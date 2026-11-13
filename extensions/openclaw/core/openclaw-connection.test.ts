import type { ChatEvent } from "@otter/core/extension-kit";
import { GatewayProtocolRequestError } from "@openclaw/gateway-client/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OpenClawProvider } from "./openclaw.js";
import type { OpenClawSettings } from "./settings.js";
import { testAgent } from "./test-agent.js";

type Options = {
  createSocket: (on: Record<string, () => void>) => unknown;
  onHello: (hello: object) => void;
  onConnectFailure: (error: Error) => unknown;
  onConnectError: (error: Error) => void;
  onActivity: () => void;
  onClose: () => void;
  onEvent: (event: { event: string; payload: unknown }) => void;
};

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  hello: {} as object,
  fail: null as null | { failure?: Error; error?: Error },
  clients: [] as { options: Options; connected: boolean }[],
  urls: [] as string[],
  onEvent: (_event: { event: string; payload: unknown }) => {},
  wake: () => {},
}));
vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    onResume: (listener: () => void) => {
      fixture.wake = listener;
      return () => {};
    },
  }),
}));
vi.mock("@openclaw/gateway-client/browser", () => ({
  GatewayBrowserDeviceAuthLifecycle: class {
    buildPlan = vi.fn();
    acceptHello = vi.fn();
  },
  GatewayProtocolRequestError: class extends Error {
    constructor(error: { message?: string }) {
      super(error.message);
    }
  },
  GatewayProtocolClient: class {
    connected = false;
    constructor(public options: Options) {
      fixture.clients.push(this);
    }
    start() {
      this.options.createSocket({});
      if (fixture.fail?.failure) return void this.options.onConnectFailure(fixture.fail.failure);
      if (fixture.fail?.error) return this.options.onConnectError(fixture.fail.error);
      fixture.onEvent = this.options.onEvent;
      this.connected = true;
      this.options.onHello(fixture.hello);
    }
    stop() {
      this.connected = false;
    }
    request = (...args: unknown[]) => fixture.request(...args);
  },
}));
vi.stubGlobal(
  "WebSocket",
  class {
    constructor(url: string) {
      fixture.urls.push(url);
    }
    addEventListener() {}
  },
);
const { createOpenClaw } = await import("./openclaw.js");
const settings = { url: "wss://gateway.test" } as OpenClawSettings;
let agent: ReturnType<typeof testAgent>;
let openclaw: OpenClawProvider;
const pairingRequest = async () => (await openclaw.settingsView!(settings)).pairingRequest;

beforeEach(() => {
  vi.useFakeTimers();
  agent = testAgent();
  openclaw = createOpenClaw(agent);
  fixture.hello = {};
  fixture.fail = null;
  fixture.clients = [];
  fixture.urls = [];
});
afterEach(() => {
  openclaw.shutdown();
  fixture.request.mockReset();
  fixture.request.mockImplementation(async () => ({}));
  vi.useRealTimers();
});

const sent = { role: "user", content: "Hi", __openclaw: { idempotencyKey: "req-1:user" } };
const running = { messages: [sent], sessionInfo: { hasActiveRun: true } };
const missing = { messages: [], sessionInfo: { hasActiveRun: false } };

let history: () => unknown = () => running;
function gateway(extra: (method: string, params: unknown) => unknown = () => undefined) {
  fixture.request.mockImplementation(async (method: string, params: unknown) => {
    const answer = await extra(method, params);
    if (answer !== undefined) return answer;
    if (method === "chat.history") return history();
    if (method === "chat.send") return { runId: "req-1" };
    if (method === "sessions.list") return { sessions: [] };
    return {};
  });
}
const calls = (method: string) =>
  fixture.request.mock.calls.filter(([name]) => name === method).map(([, params]) => params);
const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const final = () =>
  fixture.onEvent({ event: "chat", payload: { sessionKey: "s", runId: "req-1", state: "final" } });

function send(input = "Hi") {
  const events: ChatEvent[] = [];
  const ended = openclaw.sendTurn({ requestId: "req-1", input, sessionId: "s" }, settings, (e) =>
    events.push(e),
  );
  return { events, ended };
}

function resume() {
  const events: ChatEvent[] = [];
  const ended = openclaw.resume!({ requestId: "req-1", sessionId: "s" }, settings, (e) =>
    events.push(e),
  );
  return { events, ended };
}

describe("an OpenClaw connection", () => {
  it("drops a socket that misses two ticks, and a running turn picks up on a new one", async () => {
    fixture.hello = { policy: { tickIntervalMs: 1_000 } };
    history = () => running;
    gateway();
    resume();
    await flush();
    expect(fixture.clients).toHaveLength(1);
    await flush(1_500);
    fixture.clients[0].options.onActivity();
    await flush(2_000);
    expect(fixture.clients[0].connected).toBe(true);
    await flush(1_000);
    expect(fixture.clients[0].connected).toBe(false);
    await flush(1_000);
    expect(fixture.clients).toHaveLength(2);
  });

  it("drops a socket that went quiet while the Mac slept, at once on waking", async () => {
    fixture.hello = { policy: { tickIntervalMs: 30_000 } };
    history = () => running;
    gateway();
    resume();
    await flush();
    // Asleep, the clock moves on but no timer runs.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    fixture.wake();
    await flush();
    expect(fixture.clients[0].connected).toBe(false);
    await flush(1_000);
    expect(fixture.clients).toHaveLength(2);
    expect(fixture.clients[1].connected).toBe(true);
  });

  it("keeps a socket that heard the gateway lately on waking", async () => {
    fixture.hello = { policy: { tickIntervalMs: 30_000 } };
    history = () => running;
    gateway();
    resume();
    await flush(20_000);
    fixture.clients[0].options.onActivity();
    fixture.wake();
    await flush(1_000);
    expect(fixture.clients).toHaveLength(1);
    expect(fixture.clients[0].connected).toBe(true);
  });

  it("keeps trying to pick a turn up while the gateway is away", async () => {
    gateway();
    const { events } = resume();
    await flush();
    fixture.fail = { error: new Error("Can't reach the gateway.") };
    fixture.clients[0].options.onClose();
    await flush(200_000);
    expect(fixture.clients.length).toBeGreaterThan(8);
    expect(events.some((e) => e.type === "error")).toBe(false);

    agent.stored.delete("token");
    await flush(30_000);
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "detached" });
  });

  it("forgets a pairing request once connecting fails for another reason", async () => {
    const failure = (code: string) =>
      Object.assign(new Error(code), { details: { code, requestId: "pair-1" } });
    fixture.fail = { failure: failure("PAIRING_REQUIRED") };
    await openclaw.checkStatus(settings);
    expect(await pairingRequest()).toBe("pair-1");
    fixture.fail = { failure: failure("AUTH_TOKEN_MISMATCH") };
    await openclaw.checkStatus(settings);
    expect(await pairingRequest()).toBeNull();

    fixture.fail = { failure: failure("PAIRING_REQUIRED") };
    await openclaw.checkStatus(settings);
    fixture.fail = { error: new Error("Can't reach the gateway.") };
    await openclaw.checkStatus(settings);
    expect(await pairingRequest()).toBeNull();
  });

  it("says what the gateway answered when it's reached but refuses", async () => {
    gateway((method) => {
      if (method === "agents.list")
        throw new GatewayProtocolRequestError({ message: "gateway restarting" });
    });
    expect(await openclaw.checkStatus(settings)).toMatchObject({
      status: "error",
      message: "The gateway answered: gateway restarting",
    });
  });

  it("detaches running turns on a reset, and watches the new gateway", async () => {
    gateway();
    openclaw.watch!(settings, [{ id: "s", since: 0 }], () => {});
    const { events, ended } = send();
    await flush();
    expect(fixture.urls).toEqual(["wss://gateway.test"]);
    await openclaw.connect("wss://new.test", { token: "new-token" });
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "detached" });
    await flush(1_000);
    expect(fixture.urls).toEqual(["wss://gateway.test", "wss://new.test"]);
  });

  it("is each agent's own: its pairing, its gateway and its turns", async () => {
    gateway();
    const theirs = testAgent({ token: "their-token" }, "openclaw-2");
    const other = createOpenClaw(theirs);
    const { events } = send();
    const otherEvents: ChatEvent[] = [];
    void other.sendTurn(
      { requestId: "req-2", input: "Hi", sessionId: "s" },
      { url: "wss://other.test" } as OpenClawSettings,
      (e) => otherEvents.push(e),
    );
    await flush();
    expect(fixture.urls).toEqual(["wss://gateway.test", "wss://other.test"]);

    await openclaw.connect("wss://new.test", { bootstrapToken: "setup-code" });
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "detached" });
    expect(otherEvents.some((e) => e.type === "error")).toBe(false);
    expect(Object.fromEntries(agent.stored)).toEqual({ "bootstrap-token": "setup-code" });
    expect(Object.fromEntries(theirs.stored)).toEqual({ token: "their-token" });
    other.shutdown();
  });
});

describe("an OpenClaw turn whose connection drops", () => {
  it("doesn't send again when the gateway has the message", async () => {
    let first = true;
    history = () => running;
    gateway((method) => {
      if (method === "chat.send" && first) {
        first = false;
        throw new Error("gateway client stopped");
      }
    });
    const { events, ended } = send();
    await flush(1_000);
    final();
    await ended;
    expect(calls("chat.send")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("sends again under the same key when the gateway doesn't have it", async () => {
    let first = true;
    history = () => missing;
    gateway((method) => {
      if (method === "chat.send" && first) {
        first = false;
        fixture.clients[0].options.onClose();
        throw new Error("gateway closed (1006): ");
      }
    });
    const { events, ended } = send();
    await flush(5_000);
    expect(events.some((e) => e.type === "done")).toBe(false);
    final();
    await ended;
    expect(calls("chat.send")).toEqual([
      expect.objectContaining({ idempotencyKey: "req-1" }),
      expect.objectContaining({ idempotencyKey: "req-1" }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("fails when the gateway refuses the message", async () => {
    gateway((method) => {
      if (method === "chat.send") throw new GatewayProtocolRequestError({ message: "too busy" });
    });
    const { events, ended } = send();
    await flush();
    await ended;
    expect(calls("chat.send")).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      requestId: "req-1",
      type: "error",
      message: "agent_error: too busy",
    });
  });

  it("doesn't send files too large for the gateway", async () => {
    gateway();
    const { events, ended } = send("x".repeat(24 * 1024 * 1024));
    await ended;
    expect(calls("chat.send")).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({ type: "error", message: expect.stringMatching(/too large/) }),
    ]);
  });

  it("asks again to stop on the next connection", async () => {
    let first = true;
    gateway((method) => {
      if (method === "chat.abort" && first) {
        first = false;
        throw new Error("gateway client stopped");
      }
    });
    send();
    await flush();
    openclaw.cancel("req-1");
    await flush(1_000);
    expect(calls("chat.abort")).toHaveLength(2);
  });

  it("keeps asking to stop until the gateway is back, and shows it stopped at once", async () => {
    let failures = 3;
    gateway((method) => {
      if (method === "chat.abort" && failures-- > 0) throw new Error("gateway client stopped");
    });
    const { events } = send();
    await flush();
    openclaw.cancel("req-1");
    await flush();
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "cancelled" });
    await flush(1_000 + 2_000 + 5_000);
    expect(calls("chat.abort")).toHaveLength(4);
  });

  it("keeps trying to send while the gateway is away", async () => {
    let first = true;
    history = () => missing;
    gateway((method) => {
      if (method === "chat.send" && first) {
        first = false;
        fixture.fail = { error: new Error("Can't reach the gateway.") };
        fixture.clients[0].options.onClose();
        throw new Error("gateway closed (1006): ");
      }
    });
    const { events, ended } = send();
    await flush(20_000);
    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false);
    fixture.fail = null;
    await flush(30_000);
    expect(calls("chat.send")).toHaveLength(2);
    final();
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("doesn't send again for a turn that ended while it looked", async () => {
    let first = true;
    history = () => {
      void openclaw.connect("wss://gateway.test", { token: "test-token" });
      return missing;
    };
    gateway((method) => {
      if (method === "chat.send" && first) {
        first = false;
        throw new Error("gateway closed (1006): ");
      }
    });
    const { ended } = send();
    await flush(2_000);
    await ended;
    expect(calls("chat.send")).toHaveLength(1);
  });

  it("stops asking to stop once the connection is reset for a new gateway", async () => {
    gateway((method) => {
      if (method === "chat.abort") {
        void openclaw.connect("wss://new.test", { token: "new-token" });
        throw new Error("gateway client stopped");
      }
    });
    send();
    await flush();
    openclaw.cancel("req-1");
    await flush(10_000);
    expect(calls("chat.abort")).toHaveLength(1);
  });

  it("picks the turn up when the socket drops while it subscribes", async () => {
    let first = true;
    gateway((method) => {
      if (method === "sessions.messages.subscribe" && first) {
        first = false;
        fixture.clients[0].connected = false;
        fixture.clients[0].options.onClose();
        throw new Error("gateway closed (1006): ");
      }
      if (method === "exec.approval.list") return [];
    });
    send();
    await flush(2_000);
    expect(fixture.clients).toHaveLength(2);
  });
});

describe("an OpenClaw turn whose message isn't in the history read", () => {
  it("keeps what streamed when it ends", async () => {
    history = () => missing;
    gateway();
    const { events, ended } = send();
    await flush();
    fixture.onEvent({
      event: "agent",
      payload: {
        sessionKey: "s",
        runId: "req-1",
        stream: "tool",
        data: { phase: "start", name: "exec", toolCallId: "c-1", args: { command: "make" } },
      },
    });
    final();
    await ended;
    expect(events.some((e) => e.type === "transcript")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("keeps what streamed when the panel picks it up again", async () => {
    history = () => missing;
    gateway();
    const { events, ended } = send();
    await flush();
    await openclaw.resume!({ requestId: "req-1", sessionId: "s" }, settings, (e) => events.push(e));
    expect(events.some((e) => e.type === "transcript")).toBe(false);
    final();
    await ended;
  });
});
