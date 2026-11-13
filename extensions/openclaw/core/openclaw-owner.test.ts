import type { ChatEvent } from "@otter/core/extension-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { OpenClawSettings } from "./settings.js";
import { testAgent } from "./test-agent.js";

const ALL_SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.admin",
  "operator.pairing",
];

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  hello: {} as object,
}));
vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    onResume: () => () => {},
  }),
}));
vi.mock("@openclaw/gateway-client/browser", () => ({
  GatewayBrowserDeviceAuthLifecycle: class {
    buildPlan = vi.fn();
    acceptHello = vi.fn();
  },
  GatewayProtocolClient: class {
    constructor(private options: { onHello: (hello: object) => void }) {}
    start() {
      this.options.onHello(fixture.hello);
    }
    stop() {}
    request = fixture.request;
  },
}));
const { createOpenClaw, agentRunsSince } = await import("./openclaw.js");
const settings = { url: "wss://gateway.test" } as OpenClawSettings;
let openclaw = createOpenClaw(testAgent());
const owner = async () => (await openclaw.settingsView!(settings)).owner;
function reset() {
  openclaw.shutdown();
  openclaw = createOpenClaw(testAgent());
  fixture.request.mockReset();
  // What a turn still asks after it ends.
  fixture.request.mockImplementation(async () => ({}));
}
afterEach(reset);

function connect(methods: string[], scopes = ALL_SCOPES) {
  fixture.hello = { auth: { scopes }, features: { methods } };
}

function answer(extra: (method: string, params: unknown) => unknown = () => undefined) {
  fixture.request.mockImplementation(async (method: string, params: unknown) => {
    const result = extra(method, params);
    if (result instanceof Error) throw result;
    if (result !== undefined) return result;
    if (method === "chat.send" || method === "otter.chat.send") return { runId: "req-1" };
    if (method === "chat.history") return { messages: [], sessionInfo: {} };
    if (method === "question.list") return { questions: [] };
    return {};
  });
}

function send() {
  const events: ChatEvent[] = [];
  void openclaw.sendTurn(
    { requestId: "req-1", input: "Get my check-ins automation", sessionId: "s" },
    settings,
    (e) => events.push(e),
  );
  return events;
}

const sendsWith = (method: string) =>
  vi.waitFor(() =>
    expect(fixture.request).toHaveBeenCalledWith(
      method,
      {
        sessionKey: "s",
        message: "Get my check-ins automation",
        idempotencyKey: "req-1",
      },
      expect.anything(),
    ),
  );
const methods = () => fixture.request.mock.calls.map(([method]) => method);

describe("what you send from Otter", () => {
  it("goes through the Otter channel, as its owner, when the gateway has the plugin", async () => {
    connect(["chat.send", "otter.chat.send"]);
    answer();
    send();
    await sendsWith("otter.chat.send");
    expect(methods()).not.toContain("chat.send");
  });

  it("is chat.send when the gateway doesn't list Otter as an owner, or has no plugin", async () => {
    connect(["chat.send", "otter.chat.send"]);
    answer((method) => (method === "otter.chat.send" ? new Error("otter_not_owner") : undefined));
    send();
    await sendsWith("chat.send");

    reset();
    connect(["chat.send"]);
    answer();
    send();
    await sendsWith("chat.send");
    expect(methods()).not.toContain("otter.chat.send");
  });

  it("is chat.send from a device without full access, which the plugin's method needs", async () => {
    connect(["chat.send", "otter.chat.send"], ["operator.read", "operator.write"]);
    answer();
    send();
    await sendsWith("chat.send");
    expect(methods()).not.toContain("otter.chat.send");
  });

  it("isn't sent twice when the plugin fails for another reason", async () => {
    connect(["chat.send", "otter.chat.send"]);
    answer((method) => (method === "otter.chat.send" ? new Error("unreachable") : undefined));
    const events = send();
    await vi.waitFor(() => expect(events.some((e) => e.type === "error")).toBe(true));
    expect(methods()).not.toContain("chat.send");
  });

  it("is still this device's send when it comes back under the channel's own key", () => {
    const viaChannel = {
      role: "user",
      content: "Get my check-ins automation",
      idempotencyKey: "channel-user:v1:abc",
      __openclaw: {
        idempotencyKey: "channel-user:v1:abc",
        transport: { channel: "otter", messageId: "req-1" },
        runId: "req-1",
      },
    };
    const reply = {
      role: "assistant",
      content: [{ type: "text", text: "Gentle life-context check-ins." }],
      __openclaw: { runId: "req-1" },
    };
    expect(agentRunsSince([viaChannel, reply], 0)).toEqual([]);
  });
});

describe("listing Otter as the gateway's owner", () => {
  it("adds it beside the owners there are, lets its plugin brief the agent, and says when both are so", async () => {
    connect(["otter.chat.send"]);
    let owners: string[] = ["telegram:111"];
    let briefed: boolean | undefined;
    answer((method, params) => {
      if (method === "config.get")
        return {
          sourceConfig: {
            commands: { ownerAllowFrom: owners },
            plugins: { entries: { otter: { hooks: { allowConversationAccess: briefed } } } },
          },
          hash: "h-1",
        };
      if (method === "config.patch") {
        const patch = JSON.parse((params as { raw: string }).raw);
        owners = patch.commands.ownerAllowFrom;
        briefed = patch.plugins.entries.otter.hooks.allowConversationAccess;
        return { ok: true };
      }
      return undefined;
    });
    await openclaw.checkStatus(settings);
    expect(await owner()).toBe(false);

    await openclaw.allowOwner(settings);
    expect(fixture.request).toHaveBeenCalledWith(
      "config.patch",
      expect.objectContaining({ baseHash: "h-1", replacePaths: ["commands.ownerAllowFrom"] }),
    );
    expect(owners).toEqual(["telegram:111", "otter:owner"]);
    expect(briefed).toBe(true);
    expect(await owner()).toBe(true);
  });

  it("asks again when Otter is an owner but its plugin may not brief the agent yet", async () => {
    connect(["otter.chat.send"]);
    let owners: string[] = ["otter:owner"];
    let briefed: boolean | undefined;
    answer((method, params) => {
      if (method === "config.get")
        return {
          sourceConfig: {
            commands: { ownerAllowFrom: owners },
            plugins: { entries: { otter: { hooks: { allowConversationAccess: briefed } } } },
          },
          hash: "h-2",
        };
      if (method === "config.patch") {
        const patch = JSON.parse((params as { raw: string }).raw);
        owners = patch.commands.ownerAllowFrom;
        briefed = patch.plugins.entries.otter.hooks.allowConversationAccess;
        return { ok: true };
      }
      return undefined;
    });
    await openclaw.checkStatus(settings);
    expect(await owner()).toBe(false);
    await openclaw.allowOwner(settings);
    expect(owners).toEqual(["otter:owner"]);
    expect(briefed).toBe(true);
  });

  it("isn't asked about without the plugin", async () => {
    connect(["chat.send"]);
    answer();
    await openclaw.checkStatus(settings);
    expect(await owner()).toBe(null);
    expect(fixture.request).not.toHaveBeenCalledWith("config.get", expect.anything());
  });
});
