import type { ChatEvent } from "@otter/core/extension-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { OpenClawSettings } from "./settings.js";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  onEvent: (_event: { event: string; payload: unknown }) => {},
}));
vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    onResume: () => () => {},
  }),
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
const { openClawProvider } = await import("./openclaw.js");
const settings = { url: "wss://gateway.test" } as OpenClawSettings;
afterEach(() => {
  openClawProvider.shutdown();
  fixture.request.mockReset();
});

const earlier = [
  { role: "user", content: "First", __openclaw: { idempotencyKey: "req-0:user" } },
  { role: "assistant", content: [{ type: "text", text: "Earlier reply." }] },
];
const sent = {
  role: "user",
  content: "Check the build",
  __openclaw: { idempotencyKey: "req-1:user" },
};
const toolCall = {
  role: "assistant",
  content: [{ type: "toolCall", id: "call-1", name: "exec", arguments: { command: "make" } }],
};
const toolResult = { role: "toolResult", toolCallId: "call-1", toolName: "exec", content: "ok" };
const reply = { role: "assistant", content: [{ type: "text", text: "The build passes." }] };

function gateway(history: () => unknown, pending: unknown[] = []) {
  fixture.request.mockImplementation(async (method: string) => {
    if (method === "chat.history") return history();
    if (method === "exec.approval.list") return pending;
    throw new Error(`unexpected ${method}`);
  });
}

async function resume(requestId: string) {
  const events: ChatEvent[] = [];
  const ended = openClawProvider.resume!({ requestId, sessionId: "s" }, settings, (event) =>
    events.push(event),
  );
  return { events, ended };
}

describe("OpenClaw runs picked up again", () => {
  it("shows a run that finished while the app was closed, from the message that started it", async () => {
    gateway(() => ({
      messages: [...earlier, sent, toolCall, toolResult, reply],
      sessionInfo: { hasActiveRun: false, activeRunIds: [] },
    }));
    const { events, ended } = await resume("req-1");
    await ended;
    expect(events).toEqual([
      {
        requestId: "req-1",
        type: "transcript",
        messages: [
          {
            role: "assistant",
            text: "",
            toolCalls: [expect.objectContaining({ title: "Ran make" })],
          },
          { role: "tool", text: "ok", toolName: "exec" },
          { role: "assistant", text: "The build passes." },
        ],
      },
      { requestId: "req-1", type: "done", responseId: null },
    ]);
  });

  it("follows a run that's still going, with the approvals it asked for meanwhile", async () => {
    let done = false;
    gateway(
      () =>
        done
          ? { messages: [sent, reply], sessionInfo: { hasActiveRun: false, activeRunIds: [] } }
          : { messages: [sent], sessionInfo: { hasActiveRun: true, status: "running" } },
      [
        { id: "ap-1", request: { sessionKey: "s", command: "make deploy" } },
        { id: "ap-2", request: { sessionKey: "another", command: "ls" } },
      ],
    );
    const { events, ended } = await resume("req-1");
    await vi.waitFor(() => expect(events.some((e) => e.type === "approval")).toBe(true));
    const run = { sessionKey: "s", runId: "req-1" };
    fixture.onEvent({
      event: "chat",
      payload: {
        ...run,
        state: "delta",
        deltaText: "The build",
        message: { role: "assistant", content: [{ type: "text", text: "The build" }] },
      },
    });
    done = true;
    fixture.onEvent({ event: "chat", payload: { ...run, state: "final", message: reply } });
    await ended;
    expect(events.map((e) => e.type)).toEqual([
      "transcript",
      "approval",
      "delta",
      "delta",
      "transcript",
      "done",
      "approvalResolved",
    ]);
    expect(events[1]).toMatchObject({ approval: { id: "ap-1", detail: "make deploy" } });
    expect(events[4]).toMatchObject({
      messages: [{ role: "assistant", text: "The build passes." }],
    });
  });

  it("asks the user what the run asks, and answers with their choice", async () => {
    gateway(() => ({ messages: [sent], sessionInfo: { hasActiveRun: true } }));
    const resolved = vi.fn();
    const ask = {
      id: "ask_1",
      sessionKey: "s",
      runId: "req-1",
      status: "pending",
      expiresAtMs: 5000,
      questions: [
        {
          questionId: "target",
          header: "Target",
          question: "Where should I deploy?",
          options: [{ label: "Staging", description: "Safe" }, { label: "Production" }],
        },
      ],
    };
    fixture.request.mockImplementation(async (method: string, params: unknown) => {
      if (method === "chat.history")
        return { messages: [sent], sessionInfo: { hasActiveRun: true } };
      if (method === "question.list")
        return { questions: [ask, { ...ask, id: "ask_2", sessionKey: "other" }] };
      if (method === "question.resolve") return resolved(params);
      return [];
    });
    const { events, ended } = await resume("req-1");
    await vi.waitFor(() => expect(events.some((e) => e.type === "question")).toBe(true));
    expect(events.filter((e) => e.type === "question")).toEqual([
      {
        requestId: "req-1",
        type: "question",
        question: {
          id: "ask_1",
          expiresAt: 5000,
          questions: [
            {
              id: "target",
              header: "Target",
              question: "Where should I deploy?",
              options: [{ label: "Staging", description: "Safe" }, { label: "Production" }],
              multiSelect: false,
              secret: false,
            },
          ],
        },
      },
    ]);
    await openClawProvider.answerQuestion!("req-1", "ask_1", { target: ["Production"] });
    expect(resolved).toHaveBeenCalledWith({
      id: "ask_1",
      answers: { answers: { target: ["Production"] } },
    });
    expect(events.at(-1)).toEqual({
      requestId: "req-1",
      type: "questionResolved",
      questionId: "ask_1",
    });
    fixture.onEvent({
      event: "chat",
      payload: { sessionKey: "s", runId: "req-1", state: "aborted" },
    });
    await ended;
  });

  it("asks for its subagents' approvals too, and answers them on the gateway", async () => {
    const exec = (id: string) => ({
      id,
      status: "pending",
      presentation: {
        kind: "exec",
        commandText: "make deploy",
        allowedDecisions: ["allow-once", "allow-always", "deny"],
      },
    });
    const resolved = vi.fn();
    fixture.request.mockImplementation(async (method: string, params: { key?: string }) => {
      if (method === "chat.history")
        return { messages: [sent], sessionInfo: { hasActiveRun: true } };
      if (method === "sessions.messages.subscribe")
        return {
          approvalReplay: { approvals: [{ ...exec("ap-1"), sourceSessionKey: "s:child" }] },
        };
      if (method === "sessions.describe")
        return { session: { key: params.key, label: "Triager", parentSessionKey: "s" } };
      if (method === "approval.resolve") return resolved(params);
      return {};
    });
    const { events, ended } = await resume("req-1");
    await vi.waitFor(() => expect(events.some((e) => e.type === "approval")).toBe(true));
    expect(events.find((e) => e.type === "approval")).toMatchObject({
      approval: {
        id: "ap-1",
        kind: "command",
        detail: "make deploy",
        reason: "Asked by Triager",
        choices: ["once", "always", "deny"],
      },
    });

    fixture.onEvent({
      event: "session.approval",
      payload: {
        sessionKey: "s",
        sourceSessionKey: "s",
        phase: "pending",
        approval: {
          id: "plugin:ap-2",
          status: "pending",
          presentation: {
            kind: "plugin",
            title: "Create a Google Task",
            description: "Executor wants to add a reminder",
            allowedDecisions: ["allow-once", "deny"],
          },
        },
      },
    });
    fixture.onEvent({
      event: "exec.approval.requested",
      payload: { id: "ap-3", request: { sessionKey: "s", command: "ls" } },
    });
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === "approval").map((e) => e.approval.id)).toEqual([
        "ap-1",
        "plugin:ap-2",
      ]),
    );
    expect(events.at(-1)).toMatchObject({
      approval: { kind: "tool", title: "Create a Google Task", choices: ["once", "deny"] },
    });
    expect(events.at(-1)).not.toHaveProperty("approval.reason");

    await openClawProvider.respondApproval!("req-1", "ap-1", "once");
    expect(resolved).toHaveBeenCalledWith({ id: "ap-1", kind: "exec", decision: "allow-once" });
    fixture.onEvent({
      event: "session.approval",
      payload: { sessionKey: "s", phase: "terminal", approval: { id: "plugin:ap-2" } },
    });
    expect(events.filter((e) => e.type === "approvalResolved")).toEqual([
      { requestId: "req-1", type: "approvalResolved", approvalId: "ap-1" },
      { requestId: "req-1", type: "approvalResolved", approvalId: "plugin:ap-2" },
    ]);
    fixture.onEvent({
      event: "chat",
      payload: { sessionKey: "s", runId: "req-1", state: "aborted" },
    });
    await ended;
  });

  it("asks what a subagent asks, however deep, and not what other sessions do", async () => {
    const parents: Record<string, string> = { "s:child": "s", "s:grandchild": "s:child" };
    fixture.request.mockImplementation(async (method: string, params: { key?: string }) => {
      if (method === "chat.history")
        return { messages: [sent], sessionInfo: { hasActiveRun: true } };
      if (method === "sessions.describe")
        return { session: { parentSessionKey: parents[params.key ?? ""] } };
      if (method === "question.list") return { questions: [] };
      return {};
    });
    const { events, ended } = await resume("req-1");
    const ask = (id: string, sessionKey: string) =>
      fixture.onEvent({
        event: "question.requested",
        payload: {
          id,
          sessionKey,
          runId: "child-run",
          status: "pending",
          questions: [{ questionId: "pick", header: "Pick", question: "Which?", options: [] }],
        },
      });
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledWith("question.list", {}));
    ask("ask-other", "elsewhere");
    ask("ask-deep", "s:grandchild");
    await vi.waitFor(() => expect(events.some((e) => e.type === "question")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.filter((e) => e.type === "question").map((e) => e.question.id)).toEqual([
      "ask-deep",
    ]);
    fixture.onEvent({
      event: "chat",
      payload: { sessionKey: "s", runId: "req-1", state: "aborted" },
    });
    await ended;
  });

  it("says so when the message never reached the gateway", async () => {
    gateway(() => ({ messages: earlier, sessionInfo: { hasActiveRun: false } }));
    const { events, ended } = await resume("req-1");
    await ended;
    expect(events).toEqual([{ requestId: "req-1", type: "error", message: "not_received" }]);
  });
});
