import { describe, expect, it, vi } from "vite-plus/test";

const kit = vi.hoisted(() => ({
  clearHermesKey: vi.fn(async () => {}),
  saveAgentSettings: vi.fn(async () => {}),
  refreshProvider: vi.fn(async () => {}),
  preferenceChanged: vi.fn(),
}));

vi.mock("@otter-mail/core/extension-kit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...kit,
  providersState: async () => ({ providers: [], selected: "hermes" }),
  logger: { info: () => {}, error: () => {}, failure: () => {} },
}));

const { default: hermes } = await import("./index.js");

describe("disconnecting Hermes", () => {
  it("forgets the key here and the address everywhere", async () => {
    const all = new Map<string, () => Promise<unknown>>();
    hermes.activate({
      handle: (channel: string, fn: () => Promise<unknown>) => all.set(channel, fn),
      registerAgent: () => {},
    } as never);
    await all.get("agent:disconnectHermes")!();
    expect(kit.clearHermesKey).toHaveBeenCalled();
    expect(kit.saveAgentSettings).toHaveBeenCalledWith("hermes", { baseUrl: "" });
    expect(kit.refreshProvider).toHaveBeenCalledWith("hermes");
    expect(kit.preferenceChanged).toHaveBeenCalledWith("assistant");
  });
});
