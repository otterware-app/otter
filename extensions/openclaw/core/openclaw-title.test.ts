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
const settings = { url: "wss://gateway.test", model: "main" } as OpenClawSettings;
afterEach(() => {
  openClawProvider.shutdown();
  fixture.request.mockReset();
});

function start(answer: (method: string, params: Record<string, unknown>) => unknown) {
  fixture.request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    const value = answer(method, params);
    if (value !== undefined) return value;
    if (method === "chat.send") return { runId: "req-1" };
    if (method === "chat.history") return { messages: [], sessionInfo: {} };
    if (method === "question.list") return { questions: [] };
    return {};
  });
  const events: ChatEvent[] = [];
  const ended = openClawProvider.sendTurn(
    { requestId: "req-1", input: "Should I split my work into separate inboxes?" },
    settings,
    (e) => events.push(e),
  );
  const end = async () => {
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith(
        "chat.send",
        expect.anything(),
        expect.anything(),
      ),
    );
    const session = events.find((e) => e.type === "session");
    fixture.onEvent({
      event: "chat",
      payload: {
        sessionKey: session?.type === "session" ? session.sessionId : "",
        runId: "req-1",
        state: "final",
      },
    });
    await ended;
  };
  return { events, end };
}

describe("a new OpenClaw chat's title", () => {
  it("comes from the gateway's model and is kept as the session's label", async () => {
    const { events, end } = start((method) =>
      method === "sessions.title.prepare" ? { title: "Separate work inboxes" } : undefined,
    );
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        requestId: "req-1",
        type: "title",
        title: "Separate work inboxes",
      }),
    );
    expect(fixture.request).toHaveBeenCalledWith(
      "sessions.title.prepare",
      {
        agentId: "main",
        message: "Should I split my work into separate inboxes?",
      },
      expect.anything(),
    );
    const session = events.find((e) => e.type === "session");
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith("sessions.patch", {
        key: session?.type === "session" && session.sessionId,
        label: "Separate work inboxes",
      }),
    );
    await end();
  });

  it("stays the first message when the gateway has none", async () => {
    const { events, end } = start((method) =>
      method === "sessions.title.prepare" ? { title: null } : undefined,
    );
    await vi.waitFor(() =>
      expect(fixture.request).toHaveBeenCalledWith(
        "sessions.title.prepare",
        expect.anything(),
        expect.anything(),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.some((e) => e.type === "title")).toBe(false);
    expect(fixture.request).not.toHaveBeenCalledWith("sessions.patch", expect.anything());
    await end();
  });
});

describe("retitling an OpenClaw chat", () => {
  it("keeps a name given by hand as the session's label", async () => {
    fixture.request.mockResolvedValue({});
    await expect(
      openClawProvider.retitle!(settings, "agent:main:otter-mail:c-1", { title: "Inbox plan" }),
    ).resolves.toBe("Inbox plan");
    expect(fixture.request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:otter-mail:c-1",
      label: "Inbox plan",
    });
    expect(fixture.request).not.toHaveBeenCalledWith(
      "sessions.title.prepare",
      expect.anything(),
      expect.anything(),
    );
  });

  it("asks the session's agent for a new title from the message", async () => {
    fixture.request.mockImplementation(async (method: string) =>
      method === "sessions.title.prepare" ? { title: "Separate work inboxes" } : {},
    );
    await expect(
      openClawProvider.retitle!(settings, "agent:rowan:otter-mail:c-1", {
        message: "Should I split my work into separate inboxes?",
      }),
    ).resolves.toBe("Separate work inboxes");
    expect(fixture.request).toHaveBeenCalledWith(
      "sessions.title.prepare",
      {
        agentId: "rowan",
        message: "Should I split my work into separate inboxes?",
      },
      expect.anything(),
    );
    expect(fixture.request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:rowan:otter-mail:c-1",
      label: "Separate work inboxes",
    });
  });
});
