import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { OpenClawSettings } from "./settings.js";

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
    constructor(private options: { onHello: (hello: object) => void }) {}
    start() {
      this.options.onHello(fixture.hello);
    }
    stop() {}
    request = fixture.request;
  },
}));
const { openClawProvider, openClawBrowserRelay } = await import("./openclaw.js");
const settings = { url: "wss://gateway.test:8447" } as OpenClawSettings;
const KEY = "a".repeat(64);

afterEach(() => {
  openClawProvider.shutdown();
  fixture.request.mockReset();
});

function connect(methods: string[]) {
  fixture.hello = { auth: { scopes: ALL_SCOPES }, features: { methods } };
}

describe("sharing tabs with OpenClaw", () => {
  it("asks for a plugin that can pair Otter's browser", async () => {
    connect(["chat.send"]);
    await expect(openClawBrowserRelay(settings)).rejects.toThrow(/update Otter's plugin/);
  });

  it("adds the otter browser profile once, and joins the gateway's extension relay", async () => {
    connect(["otter.browser.pairing"]);
    let profiles: Record<string, unknown> = {};
    fixture.request.mockImplementation(async (method: string, params: { raw?: string }) => {
      if (method === "otter.browser.pairing") return { key: KEY, profile: "otter" };
      if (method === "config.get") return { sourceConfig: { browser: { profiles } }, hash: "h-1" };
      if (method === "config.patch") {
        profiles = JSON.parse(params.raw ?? "{}").browser.profiles;
        return { ok: true };
      }
      return {};
    });

    const relay = await openClawBrowserRelay(settings);
    expect(relay).toEqual({
      url: "wss://gateway.test:8447/browser/extension?profile=otter",
      key: KEY,
    });
    expect(profiles).toEqual({ otter: { driver: "extension" } });

    await openClawBrowserRelay(settings);
    expect(fixture.request.mock.calls.filter(([m]) => m === "config.patch")).toHaveLength(1);
  });

  it("doesn't stream the agent's browser when it works in a tab you shared", async () => {
    connect([]);
    fixture.request.mockImplementation(async (method: string) =>
      method === "chat.history"
        ? {
            messages: [
              { role: "toolResult", details: { browserTab: { targetId: "T1", profile: "otter" } } },
            ],
          }
        : {},
    );
    const view = await openClawProvider.browserView!(settings, "agent:main:otter-mail:c-1", {
      width: 800,
      height: 600,
    });
    expect(view).toBeNull();
    expect(fixture.request.mock.calls.some(([m]) => m === "browser.request")).toBe(false);
  });
});
