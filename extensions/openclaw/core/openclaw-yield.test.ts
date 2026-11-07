import type { AgentRun, ChatEvent } from "@otter-mail/core/extension-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { OpenClawSettings } from "./settings.js";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  onEvent: (_event: { event: string; payload: unknown }) => {},
}));
vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({ kind: "desktop", appVersion: "test", log: () => {} }),
}));
vi.mock("../../../packages/core/src/services/agent/settings.js", () => ({
  clearOpenClawBootstrapToken: vi.fn(),
  clearOpenClawDeviceToken: vi.fn(),
  getOpenClawBootstrapToken: async () => "",
  getOpenClawDeviceKey: async () => "",
  getOpenClawDeviceToken: async () => "",
  getOpenClawToken: async () => "test-token",
  setOpenClawDeviceKey: vi.fn(),
  setOpenClawDeviceToken: vi.fn(),
}));
vi.mock("@openclaw/gateway-client/browser", () => ({
  GatewayBrowserDeviceAuthLifecycle: class {
    buildPlan = vi.fn();
    acceptHello = vi.fn();
  },
  GatewayProtocolClient: class {
    constructor(
      private options: { onHello: (hello: object) => void; onEvent: typeof fixture.onEvent },
    ) {}
    start() {
      fixture.onEvent = this.options.onEvent;
      this.options.onHello({});
    }
    stop() {}
    request = fixture.request;
  },
}));
const { openClawProvider, agentRunsSince, turnRows, waitingOnYield } =
  await import("./openclaw.js");
const settings = { url: "wss://gateway.test" } as OpenClawSettings;
afterEach(() => {
  openClawProvider.shutdown();
  fixture.request.mockReset();
});

const sent = {
  role: "user",
  content: "Watch the checks",
  __openclaw: { idempotencyKey: "req-1:user" },
};
const row = (runId: string, content: unknown[], extra: object = {}) => ({
  role: "assistant",
  content,
  __openclaw: { runId, ...extra },
});
const yieldCall = row("req-1", [
  { type: "toolCall", id: "y-1", name: "sessions_yield", arguments: {} },
]);
const yieldResult = {
  role: "toolResult",
  toolCallId: "y-1",
  toolName: "sessions_yield",
  content: [{ type: "text", text: '{\n  "status": "yielded"\n}' }],
  __openclaw: { runId: "req-1" },
};

let history: () => unknown = () => ({ messages: [], sessionInfo: {} });
function gateway(extra: (method: string, params: unknown) => unknown = () => undefined) {
  fixture.request.mockImplementation(async (method: string, params: unknown) => {
    const answer = extra(method, params);
    if (answer !== undefined) return answer;
    if (method === "chat.history") return history();
    if (method === "chat.send") return { runId: "req-1" };
    if (method === "question.list") return { questions: [] };
    return {};
  });
}

const event = (name: string, payload: object) =>
  fixture.onEvent({ event: name, payload: { sessionKey: "s", ...payload } });
const lifecycleStart = (runId: string) =>
  event("agent", { runId, stream: "lifecycle", data: { phase: "start" } });
const say = (runId: string, itemId: string, text: string) =>
  event("agent", { runId, stream: "assistant", data: { itemId, text, delta: text } });

function send() {
  const events: ChatEvent[] = [];
  const ended = openClawProvider.sendTurn(
    { requestId: "req-1", input: "Watch the checks", sessionId: "s" },
    settings,
    (e) => events.push(e),
  );
  return { events, ended };
}

const settled = (events: ChatEvent[]) =>
  events.some((e) => e.type === "done" || e.type === "error");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("an OpenClaw turn that hands off with sessions_yield", () => {
  it("waits for the run its completion starts, and shows that run's reply in the same turn", async () => {
    gateway();
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    say("req-1", "i-1", "Watching the checks.");
    event("agent", {
      runId: "req-1",
      stream: "tool",
      data: { phase: "start", name: "sessions_yield", toolCallId: "y-1" },
    });
    event("agent", {
      runId: "req-1",
      stream: "tool",
      data: {
        phase: "result",
        name: "sessions_yield",
        toolCallId: "y-1",
        result: { content: [{ type: "text", text: '{"status":"yielded"}' }] },
      },
    });
    event("chat", { runId: "req-1", state: "final", yielded: true });
    await tick();
    expect(settled(events)).toBe(false);

    lifecycleStart("announce:1");
    say("announce:1", "i-2", "All checks passed.");
    event("chat", { runId: "announce:1", state: "final" });
    await ended;

    expect(events.filter((e) => e.type === "tool")).toEqual([]);
    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual([
      "Watching the checks.",
      "All checks passed.",
    ]);
    const ids = events.flatMap((e) => (e.type === "delta" ? [e.id] : []));
    expect(new Set(ids).size).toBe(2);
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("doesn't take a message sent meanwhile from another device for its continuation", async () => {
    gateway((method) => (method === "sessions.list" ? { sessions: [] } : undefined));
    openClawProvider.watch!(settings, [{ id: "s", since: 0 }], () => {});
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    event("chat", { runId: "req-1", state: "final", yielded: true });
    event("session.message", {
      message: { role: "user", content: "hi", __openclaw: { idempotencyKey: "elsewhere:user" } },
    });
    lifecycleStart("elsewhere");
    say("elsewhere", "i-x", "Their reply.");
    lifecycleStart("announce:1");
    say("announce:1", "i-2", "All checks passed.");
    event("chat", { runId: "announce:1", state: "final" });
    await ended;
    expect(events.filter((e) => e.type === "delta").map((e) => e.text)).toEqual([
      "All checks passed.",
    ]);
  });

  it("ends when a run finishes without yielding, and ignores other runs then", async () => {
    gateway();
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    lifecycleStart("other");
    say("other", "i-x", "Not this turn's.");
    event("chat", { runId: "req-1", state: "final" });
    await ended;
    expect(events.filter((e) => e.type === "delta")).toEqual([]);
  });

  it("ends when a message is sent while it waits: that message is a turn of its own", async () => {
    gateway();
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    event("chat", { runId: "req-1", state: "final", yielded: true });
    expect(await openClawProvider.steer("req-1", "and the docs?")).toBe(false);
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("keeps a steer its own when the run yields before the steer's send comes back", async () => {
    let answer: (value: unknown) => void = () => {};
    let steerKey = "";
    gateway((method, params) => {
      if (method === "sessions.list") return { sessions: [] };
      const p = params as { queueMode?: string; idempotencyKey?: string };
      if (method !== "chat.send" || p.queueMode !== "steer") return undefined;
      steerKey = p.idempotencyKey ?? "";
      return new Promise((resolve) => (answer = resolve));
    });
    openClawProvider.watch!(settings, [{ id: "s", since: 0 }], () => {});
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    const steered = openClawProvider.steer("req-1", "and the docs?");
    await vi.waitFor(() => expect(steerKey).not.toBe(""));
    event("chat", { runId: "req-1", state: "final", yielded: true });
    event("session.message", {
      message: {
        role: "user",
        content: "and the docs?",
        __openclaw: { idempotencyKey: `${steerKey}:user` },
      },
    });
    await tick();
    expect(settled(events)).toBe(false);
    answer({ runId: steerKey });
    expect(await steered).toBe(true);
    event("chat", { runId: steerKey, state: "final" });
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("ends when a message is sent from another device while it waits", async () => {
    gateway((method) => (method === "sessions.list" ? { sessions: [] } : undefined));
    const started: AgentRun[] = [];
    openClawProvider.watch!(settings, [{ id: "s", since: 0 }], (run) => started.push(run));
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    event("chat", { runId: "req-1", state: "final", yielded: true });
    event("session.message", {
      message: { role: "user", content: "hi", __openclaw: { idempotencyKey: "phone:user" } },
    });
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
    lifecycleStart("phone");
    lifecycleStart("announce:5");
    expect(started).toEqual([{ sessionId: "s", requestId: "run:announce:5" }]);
  });

  it("stops waiting when asked to", async () => {
    gateway();
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    event("chat", { runId: "req-1", state: "final", yielded: true });
    openClawProvider.cancel("req-1");
    await ended;
    expect(fixture.request).toHaveBeenCalledWith("chat.abort", { sessionKey: "s" });
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "cancelled" });
  });

  it("is still waiting when picked up again after the app quit, and follows the continuation", async () => {
    history = () => ({
      messages: [sent, yieldCall, yieldResult, row("req-1", [{ type: "text", text: "" }])],
      sessionInfo: { hasActiveRun: false, activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    const ended = openClawProvider.resume!({ requestId: "req-1", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    await vi.waitFor(() => expect(events.map((e) => e.type)).toEqual(["transcript"]));
    expect(events[0]).toMatchObject({ messages: [] });
    lifecycleStart("announce:1");
    say("announce:1", "i-2", "All checks passed.");
    const before = history();
    history = () => ({
      ...(before as object),
      messages: [
        ...(before as { messages: object[] }).messages,
        row("announce:1", [{ type: "text", text: "All checks passed." }]),
      ],
    });
    event("chat", { runId: "announce:1", state: "final" });
    await ended;
    expect(events.map((e) => e.type)).toEqual(["transcript", "delta", "transcript", "done"]);
    expect(events[2]).toMatchObject({
      messages: [{ role: "assistant", text: "All checks passed." }],
    });
  });
});

describe("a turn picked up again", () => {
  it("follows a continuation that's already writing", async () => {
    history = () => ({
      messages: [
        sent,
        yieldCall,
        yieldResult,
        row("announce:1", [{ type: "text", text: "Halfway" }]),
      ],
      sessionInfo: { activeRunIds: ["announce:1"] },
    });
    gateway();
    const events: ChatEvent[] = [];
    const ended = openClawProvider.resume!({ requestId: "req-1", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    await vi.waitFor(() => expect(events.map((e) => e.type)).toEqual(["transcript"]));
    event("chat", { runId: "announce:1", state: "final" });
    await ended;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("ends at a yield when a message is sent after it", () => {
    const later = { role: "user", content: "and?", __openclaw: { idempotencyKey: "req-2:user" } };
    const rows = [
      sent,
      yieldCall,
      yieldResult,
      later,
      row("req-2", [{ type: "text", text: "Sure." }]),
    ];
    expect(turnRows(rows, "req-1", "req-1")).toEqual([yieldCall, yieldResult]);
  });

  it("is over when a message was sent after its yield, even if the continuation came later", async () => {
    const later = { role: "user", content: "and?", __openclaw: { idempotencyKey: "req-2:user" } };
    history = () => ({
      messages: [
        sent,
        yieldCall,
        yieldResult,
        later,
        row("req-2", [{ type: "text", text: "Sure." }]),
        row("announce:1", [{ type: "text", text: "Checks passed." }]),
      ],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    await openClawProvider.resume!({ requestId: "req-1", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("is its own run, its continuation and its steers, not a wake that came after", () => {
    const steer = {
      role: "user",
      content: "also this",
      __openclaw: { idempotencyKey: "steer-1:user" },
    };
    const rows = [
      sent,
      row("req-1", [{ type: "text", text: "First." }]),
      steer,
      row("steer-1", [{ type: "text", text: "Also done." }]),
      row("wake-1", [{ type: "text", text: "A wake." }]),
    ];
    expect(turnRows(rows, "req-1", "req-1")?.map((m) => m.__openclaw)).toEqual([
      { runId: "req-1" },
      steer.__openclaw,
      { runId: "steer-1" },
    ]);
  });
});

describe("an OpenClaw turn's steps", () => {
  it("show the tool's output, and steps whose result never came are read from the transcript", async () => {
    history = () => ({
      messages: [
        sent,
        row("req-1", [
          { type: "toolCall", id: "c-1", name: "exec", arguments: { command: "date" } },
          {
            type: "toolCall",
            id: "c-2",
            name: "exec",
            arguments: { command: "gh pr checks 268 --watch" },
          },
        ]),
        { role: "toolResult", toolCallId: "c-1", toolName: "exec", content: "Thu Nov 5" },
        { role: "toolResult", toolCallId: "c-2", toolName: "exec", content: "All checks passed" },
        row("req-1", [{ type: "text", text: "Done." }]),
      ],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const { events, ended } = send();
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("chat.send", expect.anything()),
    );
    const tool = (data: object) => event("agent", { runId: "req-1", stream: "tool", data });
    tool({ phase: "start", name: "exec", toolCallId: "c-1", args: { command: "date" } });
    tool({
      phase: "result",
      name: "exec",
      toolCallId: "c-1",
      result: { content: [{ type: "text", text: "Thu Nov 5\n" }] },
    });
    event("agent", {
      runId: "req-1",
      stream: "item",
      data: { kind: "tool", phase: "end", toolCallId: "c-1", status: "completed" },
    });
    tool({
      phase: "start",
      name: "exec",
      toolCallId: "c-2",
      args: { command: "gh pr checks 268 --watch" },
    });
    tool({
      phase: "start",
      name: "executor__search",
      toolCallId: "c-3",
      args: { query: "retrieveIssue" },
    });
    tool({ phase: "result", name: "executor__search", toolCallId: "c-3" });
    event("chat", { runId: "req-1", state: "final" });
    await ended;
    expect(events.filter((e) => e.type === "toolResult")).toEqual([
      { requestId: "req-1", type: "toolResult", id: "c-1", output: "Thu Nov 5" },
      { requestId: "req-1", type: "toolResult", id: "c-3", output: "(done)" },
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "transcript",
      messages: expect.arrayContaining([
        { role: "tool", text: "All checks passed", toolName: "exec" },
      ]),
    });
  });
});

describe("runs the agent starts on its own", () => {
  it("are reported for watched chats with no turn going, once each", async () => {
    gateway((method) => (method === "sessions.list" ? { sessions: [] } : undefined));
    const started: AgentRun[] = [];
    openClawProvider.watch!(settings, [{ id: "s", since: 0 }], (run) => started.push(run));
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledWith("sessions.subscribe", {}));
    lifecycleStart("wake-1");
    lifecycleStart("wake-1");
    fixture.onEvent({
      event: "agent",
      payload: {
        sessionKey: "unwatched",
        runId: "wake-2",
        stream: "lifecycle",
        data: { phase: "start" },
      },
    });
    expect(started).toEqual([{ sessionId: "s", requestId: "run:wake-1" }]);

    // Sent from another device, and the continuation of a run that yielded there: theirs.
    event("session.message", {
      message: { role: "user", content: "hi", __openclaw: { idempotencyKey: "elsewhere:user" } },
    });
    lifecycleStart("elsewhere");
    event("chat", { runId: "elsewhere", state: "final", yielded: true });
    lifecycleStart("announce:9");
    lifecycleStart("wake-3");
    expect(started.map((r) => r.requestId)).toEqual(["run:wake-1", "run:wake-3"]);

    // A message sent while a run waits on a yield: the wake after it is still the agent's own.
    event("chat", { runId: "wake-3", state: "final", yielded: true });
    event("session.message", {
      message: { role: "user", content: "and?", __openclaw: { idempotencyKey: "steer-9:user" } },
    });
    lifecycleStart("steer-9");
    lifecycleStart("wake-5");
    expect(started.map((r) => r.requestId)).toEqual(["run:wake-1", "run:wake-3", "run:wake-5"]);
  });

  it("are caught up on in a chat whose turn was picked up again, once that turn ends", async () => {
    const wake = row("wake-7", [{ type: "text", text: "Done while you were away." }], {
      recordTimestampMs: 5,
    });
    history = () => ({ messages: [sent, row("req-1", [{ type: "text", text: "Ok." }]), wake] });
    gateway((method) =>
      method === "sessions.list" ? { sessions: [{ key: "s", lastActivityAt: 5 }] } : undefined,
    );
    const started: AgentRun[] = [];
    openClawProvider.watch!(settings, [{ id: "s", since: Number.MAX_SAFE_INTEGER }], (run) =>
      started.push(run),
    );
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("sessions.list", { limit: 200 }),
    );
    await tick();
    expect(started).toEqual([]);
    // The resumed turn ended now, long after the wake.
    openClawProvider.watch!(settings, [{ id: "s", since: Date.now() }], (run) => started.push(run));
    await vi.waitFor(() => expect(started).toEqual([{ sessionId: "s", requestId: "run:wake-7" }]));
  });

  it("are followed from their first row, and a silent one just ends", async () => {
    history = () => ({
      messages: [
        sent,
        row("req-1", [{ type: "text", text: "Watching." }]),
        row("wake-1", [{ type: "text", text: "Checks passed." }]),
      ],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    await openClawProvider.resume!({ requestId: "run:wake-1", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    expect(events).toEqual([
      {
        requestId: "run:wake-1",
        type: "transcript",
        messages: [{ role: "assistant", text: "Checks passed." }],
      },
      { requestId: "run:wake-1", type: "done", responseId: null },
    ]);
    events.length = 0;
    await openClawProvider.resume!({ requestId: "run:quiet", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    expect(events).toEqual([{ requestId: "run:quiet", type: "done", responseId: null }]);
  });

  it("are caught up on: the runs after the last message, but not its own or what continued it", () => {
    const at = (ms: number) => ({ recordTimestampMs: ms });
    const rows = [
      sent,
      { ...yieldCall, __openclaw: { runId: "req-1", ...at(1_000) } },
      yieldResult,
      row("announce:1", [{ type: "text", text: "Continued." }], at(2_000)),
      row("wake-1", [{ type: "text", text: "Later." }], at(3_000)),
      row("wake-1", [{ type: "text", text: "More." }], at(3_100)),
      row("wake-2", [{ type: "text", text: "Even later." }], at(9_000)),
    ];
    expect(agentRunsSince(rows, 0)).toEqual(["wake-1", "wake-2"]);
    expect(agentRunsSince(rows, 5_000)).toEqual(["wake-2"]);
    const silent = row("wake-3", [{ type: "text", text: "" }], at(10_000));
    expect(agentRunsSince([...rows, silent], 5_000)).toEqual(["wake-2"]);
    // Going now: one with nothing to show yet, and one that hasn't written anything.
    expect(agentRunsSince([...rows, silent], 20_000, ["wake-3", "wake-4"])).toEqual([
      "wake-3",
      "wake-4",
    ]);
    // Not the last message's own run, nor the continuation of a yield.
    expect(agentRunsSince([sent], 0, ["req-1"])).toEqual([]);
    // The message's run wrote nothing (it failed): the run after it is still the agent's own.
    expect(
      agentRunsSince([sent, row("wake-8", [{ type: "text", text: "Hi." }], at(1))], 0),
    ).toEqual(["wake-8"]);
    // A run of its own that yielded before `since`, whose continuation is going now.
    const own = [
      sent,
      row("req-1", [{ type: "text", text: "Ok." }], at(1)),
      { ...yieldCall, __openclaw: { runId: "wake-9", ...at(2) } },
      { ...yieldResult, __openclaw: { runId: "wake-9" } },
      row("announce:9", [{ type: "toolCall", id: "t", name: "exec", arguments: {} }], at(9)),
    ];
    expect(agentRunsSince(own, 5, ["announce:9"])).toEqual(["wake-9"]);
    expect(
      agentRunsSince([sent, { ...yieldCall, __openclaw: { runId: "req-1" } }, yieldResult], 0, [
        "announce:1",
      ]),
    ).toEqual([]);
    expect(
      agentRunsSince([...rows, { ...sent, __openclaw: { idempotencyKey: "req-2:user" } }], 0),
    ).toEqual([]);
  });

  it("show only their own run and its continuations", async () => {
    history = () => ({
      messages: [
        sent,
        row("req-1", [{ type: "text", text: "Watching." }]),
        row("wake-1", [{ type: "toolCall", id: "y-2", name: "sessions_yield", arguments: {} }]),
        { ...yieldResult, toolCallId: "y-2", __openclaw: { runId: "wake-1" } },
        row("announce:2", [{ type: "text", text: "Subagent says hi." }]),
        row("wake-2", [{ type: "text", text: "Unrelated." }]),
      ],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    await openClawProvider.resume!({ requestId: "run:wake-1", sessionId: "s" }, settings, (e) =>
      events.push(e),
    );
    expect(events[0]).toEqual({
      requestId: "run:wake-1",
      type: "transcript",
      messages: [{ role: "assistant", text: "Subagent says hi." }],
    });
  });
});

describe("waitingOnYield", () => {
  it("is true only while nothing has come after an accepted yield", () => {
    expect(waitingOnYield([sent, yieldCall, yieldResult])).toBe(true);
    expect(
      waitingOnYield([
        sent,
        yieldCall,
        yieldResult,
        row("announce:1", [{ type: "text", text: "Done." }]),
      ]),
    ).toBe(false);
    const nothing = {
      ...yieldResult,
      content: [{ type: "text", text: '{"status":"nothing_pending"}' }],
    };
    expect(waitingOnYield([sent, yieldCall, nothing])).toBe(false);
  });
});

describe("what an agent delivers to Otter", () => {
  const delivered = (id: string, text: string, at: number, model = "automation-result") => ({
    role: "assistant",
    content: [{ type: "text", text }],
    model,
    __openclaw: { id, recordTimestampMs: at },
  });

  it("is a turn of its own for each delivery, after the last message sent", () => {
    const rows = [
      delivered("d-1", "Waiting on your approval: move 2 emails to Junk.", 10),
      sent,
      row("req-1", [{ type: "text", text: "Moved." }]),
      delivered("d-2", "Daily summary.", 30, "delivery-mirror"),
      delivered("d-3", "Checks passed.", 40),
    ];
    expect(agentRunsSince(rows, 0)).toEqual(["delivery:d-2", "delivery:d-3"]);
    expect(agentRunsSince(rows, 35)).toEqual(["delivery:d-3"]);
    expect(turnRows(rows, "run:delivery:d-2", "delivery:d-2")).toEqual([rows[3]]);
  });

  it("doesn't come between a run that yielded and its continuation", () => {
    const delivery = delivered("d-1", "Daily summary.", 20);
    const continuation = row("announce:1", [{ type: "text", text: "Subagents done." }]);
    const rows = [sent, yieldCall, yieldResult, delivery, continuation];
    expect(turnRows(rows, "req-1", "req-1")).toEqual([yieldCall, yieldResult, continuation]);
    expect(turnRows(rows, "run:delivery:d-1", "delivery:d-1")).toEqual([delivery]);
    expect(agentRunsSince(rows, 0)).toEqual(["delivery:d-1"]);
    // Still waiting on the yield with a delivery after it: what starts next is the continuation.
    expect(agentRunsSince([sent, yieldCall, yieldResult, delivery], 0, ["announce:2"])).toEqual([
      "delivery:d-1",
    ]);
  });

  it("starts a chat named for the agent when it has none, with what's new, and catches up when told", async () => {
    const now = Date.now();
    let messages = [delivered("d-old", "Old news.", now - 2 * 24 * 60 * 60 * 1000)];
    gateway((method) => {
      if (method === "sessions.list")
        return {
          sessions: [
            { key: "agent:main:otter:inbox", lastActivityAt: now },
            { key: "agent:main:main", lastActivityAt: now },
          ],
        };
      if (method === "agents.list")
        return { agents: [{ id: "main", identity: { name: "Rowan" } }] };
      if (method === "chat.history") return { messages };
      return undefined;
    });
    const started: AgentRun[] = [];
    openClawProvider.watch!(settings, [], (run) => started.push(run));
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("sessions.list", { limit: 200 }),
    );
    await tick();
    expect(started).toEqual([]);

    messages = [...messages, delivered("d-new", "Waiting on your approval.", now)];
    openClawProvider.delivered!(settings);
    await vi.waitFor(() =>
      expect(started).toEqual([
        {
          sessionId: "agent:main:otter:inbox",
          requestId: "run:delivery:d-new",
          chat: { title: "Rowan" },
          deliveredAt: now,
        },
      ]),
    );
    expect(fixture.request).not.toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main:main",
      limit: 200,
    });

    // Once the chat exists it's watched like any other, from its last turn.
    openClawProvider.watch!(settings, [{ id: "agent:main:otter:inbox", since: now }], (run) =>
      started.push(run),
    );
    messages = [...messages, delivered("d-next", "Done.", now + 1)];
    openClawProvider.delivered!(settings);
    await vi.waitFor(() =>
      expect(started.at(-1)).toEqual({
        sessionId: "agent:main:otter:inbox",
        requestId: "run:delivery:d-next",
        deliveredAt: now + 1,
      }),
    );
  });

  it("is followed like a run: its text, then done", async () => {
    history = () => ({
      messages: [delivered("d-1", "Waiting on your approval.", 10)],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    await openClawProvider.resume!(
      { requestId: "run:delivery:d-1", sessionId: "agent:main:otter:inbox" },
      settings,
      (e) => events.push(e),
    );
    expect(events).toEqual([
      {
        requestId: "run:delivery:d-1",
        type: "transcript",
        messages: [{ role: "assistant", text: "Waiting on your approval." }],
      },
      { requestId: "run:delivery:d-1", type: "done", responseId: null },
    ]);
  });

  it("leaves out the link to the cron run in the gateway's own UI", async () => {
    const link = "https://gw.example.ts.net:8447/chat/main/cron/job-1/run/run-1";
    history = () => ({
      messages: [delivered("d-1", `Hi Chris.\nInspect: ${link}`, 10)],
      sessionInfo: { activeRunIds: [] },
    });
    gateway();
    const events: ChatEvent[] = [];
    await openClawProvider.resume!(
      { requestId: "run:delivery:d-1", sessionId: "agent:main:otter:inbox" },
      settings,
      (e) => events.push(e),
    );
    expect(events[0]).toMatchObject({ messages: [{ role: "assistant", text: "Hi Chris." }] });
  });
});
