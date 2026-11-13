import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const files = new Map<string, unknown>();
const secrets = new Map<string, string>();
vi.mock("../../json-file.js", () => ({
  readJson: async (name: string) => files.get(name),
  writeJson: async (name: string, value: unknown) => void files.set(name, value),
}));
vi.mock("../../platform.js", () => ({
  platform: () => ({
    secrets: {
      get: async (name: string) => secrets.get(name) ?? null,
      set: async (name: string, value: string) => void secrets.set(name, value),
      delete: async (name: string) => void secrets.delete(name),
    },
  }),
}));
vi.mock("../../ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("../../logger.js", () => ({ logger: { info: vi.fn() } }));

const made: { id: string; shutdown: ReturnType<typeof vi.fn> }[] = [];
const ready = async () => ({
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  models: [],
  model: null,
  sessions: true,
});
const hermes = {
  kind: "hermes",
  displayName: "Hermes",
  defaults: { enabled: true, model: "", baseUrl: "" },
  fields: { enabled: "boolean", model: "string", baseUrl: "string" },
  secrets: ["key"],
  syncedSecret: "key",
  create({ id }: { id: string }) {
    const provider = {
      id,
      shutdown: vi.fn(),
      checkStatus: ready,
      listSessions: async () => [],
    };
    made.push(provider);
    return provider;
  },
};
const claude = {
  kind: "claude",
  displayName: "Claude",
  defaults: { enabled: true, model: "", binaryPath: "" },
  fields: { enabled: "boolean", model: "string", binaryPath: "string" },
  deviceFields: ["binaryPath"],
  create: () => ({ shutdown: vi.fn(), checkStatus: ready }),
};
vi.mock("../../extensions.js", () => ({
  registeredAgents: () =>
    new Map<string, unknown>([
      ["hermes", hermes],
      ["claude", claude],
    ]),
}));

const service = await import("./service.js");
const { getProviderSettings, saveProviderSettings } = await import("./settings.js");

beforeEach(async () => {
  files.clear();
  secrets.clear();
  made.length = 0;
  await saveProviderSettings({ selected: null, agents: [], removed: [] });
});

describe("the agents you add", () => {
  it("starts with none, then adds as many of a kind as you like, each its own", async () => {
    expect(await service.providersState()).toMatchObject({ providers: [], selected: null });
    const brokk = (await service.addAgent("hermes")).id;
    const { id: rata, state } = await service.addAgent("hermes");
    expect(state.providers.map((p) => [p.id, p.kind, p.name])).toEqual([
      [brokk, "hermes", "Hermes"],
      [rata, "hermes", "Hermes 2"],
    ]);
    expect(state.selected).toBe(brokk);

    await service.updateProviderSettings({
      [brokk]: { name: " brokk ", baseUrl: "https://brokk.example" },
      [rata]: { name: "rata", baseUrl: "https://rata.example", unknown: "dropped" },
      selected: rata,
    });
    expect(await service.agentSettings(brokk)).toMatchObject({ baseUrl: "https://brokk.example" });
    expect(await service.agentSettings(rata)).toMatchObject({ baseUrl: "https://rata.example" });
    expect(await service.agentSettings(rata)).not.toHaveProperty("unknown");
    const after = await service.providersState();
    expect(after.providers.map((p) => p.name)).toEqual(["brokk", "rata"]);
    expect(after.selected).toBe(rata);

    expect(await service.agentProvider(brokk)).not.toBe(await service.agentProvider(rata));
    expect(made.map((p) => p.id).sort()).toEqual([brokk, rata].sort());
  });

  it("removes one with its secrets, leaving the others", async () => {
    const brokk = (await service.addAgent("hermes")).id;
    const rata = (await service.addAgent("hermes")).id;
    secrets.set(`agent:${brokk}:key`, "sk-brokk");
    secrets.set(`agent:${rata}:key`, "sk-rata");
    const provider = (await service.agentProvider(brokk)) as unknown as (typeof made)[number];

    const state = await service.removeAgent(brokk);
    expect(state.providers.map((p) => p.id)).toEqual([rata]);
    expect(state.selected).toBe(rata);
    expect(provider.shutdown).toHaveBeenCalled();
    expect(secrets.has(`agent:${brokk}:key`)).toBe(false);
    expect(secrets.get(`agent:${rata}:key`)).toBe("sk-rata");
    await expect(service.sendTurn(brokk, { requestId: "r", input: "hi" })).rejects.toThrow(
      "isn't on this device",
    );
  });
});

describe("following the account", () => {
  it("sends the agents without what's this device's, and their keys apart", async () => {
    const brokk = (await service.addAgent("hermes")).id;
    const cc = (await service.addAgent("claude")).id;
    await service.updateProviderSettings({ [cc]: { binaryPath: "/opt/claude" } });
    secrets.set(`agent:${brokk}:key`, "sk-brokk");

    const synced = await service.syncedProviderSettings();
    expect(synced.agents.find((a) => a.id === cc)?.settings).toEqual({});
    expect(await service.syncedAgentKeys()).toEqual({ [brokk]: "sk-brokk" });
  });

  it("takes another device's list: adds, renames and removes, keeping device fields", async () => {
    const cc = (await service.addAgent("claude")).id;
    const old = (await service.addAgent("hermes")).id;
    await service.updateProviderSettings({ [cc]: { binaryPath: "/opt/claude" } });
    secrets.set(`agent:${old}:key`, "sk-old");

    await service.applySyncedProviderSettings({
      selected: "rata",
      agents: [
        { id: cc, kind: "claude", name: "Work Claude", settings: { enabled: true, model: "opus" } },
        { id: "rata", kind: "hermes", name: "rata", settings: { baseUrl: "https://rata.example" } },
        { id: "far", kind: "varys", name: "Elsewhere", settings: { address: "x" } },
      ] as never,
      removed: [old],
    });
    await service.applySyncedAgentKeys({ rata: "sk-rata" });

    const { agents, selected, removed } = await getProviderSettings();
    expect(agents.map((a) => [a.id, a.name])).toEqual([
      [cc, "Work Claude"],
      ["rata", "rata"],
      ["far", "Elsewhere"],
    ]);
    expect(selected).toBe("rata");
    expect(removed).toEqual([old]);
    expect(await service.agentSettings(cc)).toMatchObject({
      model: "opus",
      binaryPath: "/opt/claude",
    });
    expect(secrets.has(`agent:${old}:key`)).toBe(false);
    expect(secrets.get("agent:rata:key")).toBe("sk-rata");
    expect((await service.providersState()).providers.map((p) => p.id)).toEqual([cc, "rata"]);
  });

  it("keeps an agent added here the account hasn't heard of, and never brings back a removed one", async () => {
    const mine = (await service.addAgent("hermes")).id;
    const gone = (await service.addAgent("hermes")).id;
    await service.removeAgent(gone);

    await service.applySyncedProviderSettings({
      selected: null,
      agents: [
        { id: "rata", kind: "hermes", name: "rata", settings: {} },
        { id: gone, kind: "hermes", name: "Back again?", settings: {} },
      ] as never,
      removed: [],
    });

    const synced = await service.syncedProviderSettings();
    expect(synced.agents.map((a) => a.id)).toEqual(["rata", mine]);
    expect(synced.removed).toEqual([gone]);
  });
});
