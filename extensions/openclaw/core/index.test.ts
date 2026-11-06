import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const kit = vi.hoisted(() => ({
  settings: { enabled: true, url: "", model: "" } as Record<string, unknown>,
  saveAgentSettings: vi.fn(async (_kind: string, patch: Record<string, unknown>) => {
    Object.assign(kit.settings, patch);
  }),
  broadcast: vi.fn(),
  refreshProvider: vi.fn(async () => {}),
  clearOpenClawToken: vi.fn(async () => {}),
  clearOpenClawBootstrapToken: vi.fn(async () => {}),
}));

vi.mock("@otter-mail/core/extension-kit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentSettings: async () => ({ ...kit.settings }),
  saveAgentSettings: kit.saveAgentSettings,
  broadcast: kit.broadcast,
  refreshProvider: kit.refreshProvider,
  providersState: async () => ({ providers: [], selected: "openclaw" }),
  logger: { info: () => {}, error: () => {}, failure: () => {} },
  clearOpenClawToken: kit.clearOpenClawToken,
  clearOpenClawBootstrapToken: kit.clearOpenClawBootstrapToken,
}));
vi.mock("./openclaw.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resetOpenClawConnection: vi.fn(async () => {}),
}));

const { default: openclaw, importSwiftSettings } = await import("./index.js");

function handlers() {
  const all = new Map<string, (params?: unknown) => Promise<unknown>>();
  openclaw.activate({
    handle: (channel: string, fn: (params?: unknown) => Promise<unknown>) => all.set(channel, fn),
    registerAgent: () => {},
  } as never);
  return all;
}

beforeEach(() => {
  kit.settings = { enabled: true, url: "", model: "" };
  vi.clearAllMocks();
});

describe("importing the Swift app's settings", () => {
  it("takes the gateway, model and switch when core has no gateway", async () => {
    expect(
      await importSwiftSettings({ url: "computer.tail.ts.net", model: "main", enabled: false }),
    ).toEqual({ imported: true });
    expect(kit.settings).toEqual({
      url: "wss://computer.tail.ts.net",
      model: "main",
      enabled: false,
    });
    expect(kit.refreshProvider).toHaveBeenCalledWith("openclaw");
    expect(kit.broadcast).not.toHaveBeenCalled();
  });

  it("leaves a gateway core already has", async () => {
    kit.settings.url = "wss://other.ts.net";
    expect(await importSwiftSettings({ url: "wss://computer.ts.net" })).toEqual({
      imported: false,
    });
    expect(kit.saveAgentSettings).not.toHaveBeenCalled();
  });

  it("ignores no gateway at all", async () => {
    expect(await importSwiftSettings({ model: "main" })).toEqual({ imported: false });
  });

  it("picks up the run it left open as that session's chat", async () => {
    await importSwiftSettings({
      url: "wss://computer.ts.net",
      run: { session: "agent:main:otter", run: "r-1" },
    });
    expect(kit.broadcast).toHaveBeenCalledWith("agent:runStarted", {
      provider: "openclaw",
      sessionId: "agent:main:otter",
      requestId: "r-1",
      chat: { title: "OpenClaw" },
    });
  });
});

describe("disconnecting", () => {
  it("forgets the gateway and its tokens", async () => {
    kit.settings.url = "wss://computer.ts.net";
    await handlers().get("agent:disconnectOpenClaw")!();
    expect(kit.clearOpenClawToken).toHaveBeenCalled();
    expect(kit.clearOpenClawBootstrapToken).toHaveBeenCalled();
    expect(kit.settings.url).toBe("");
    expect(kit.refreshProvider).toHaveBeenCalledWith("openclaw");
  });
});
