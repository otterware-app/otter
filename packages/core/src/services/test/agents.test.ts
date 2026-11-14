import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const secrets = new Map<string, string>();
const database = new DatabaseSync(":memory:");
vi.mock("../../platform.js", () => ({
  platform: () => ({
    database: () => database,
    secrets: {
      get: async (name: string) => secrets.get(name) ?? null,
      set: async (name: string, value: string) => void secrets.set(name, value),
      delete: async (name: string) => void secrets.delete(name),
    },
  }),
}));
vi.mock("../otter-account.js", () => ({
  RelayError: Error,
  getOtterUser: () => ({ id: "u1" }),
  onOtterAccountChange: () => {},
  relayRequest: () => new Promise(() => {}),
}));
vi.mock("../../ipc.js", () => ({ broadcast: vi.fn() }));
vi.mock("../../logger.js", () => ({ logger: { info: vi.fn(), failure: vi.fn() } }));

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

const service = await import("../agent/service.js");
const { getProviderSettings } = await import("../agent/settings.js");
const { agentDb } = await import("../agent-sync.js");

beforeEach(async () => {
  secrets.clear();
  made.length = 0;
  agentDb().exec("DELETE FROM agent_entries; DELETE FROM agent_outbox;");
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
  it("shares the agents, and keeps each device's own fields to that device", async () => {
    const cc = (await service.addAgent("claude")).id;
    await service.updateProviderSettings({ [cc]: { model: "opus", binaryPath: "/opt/claude" } });

    const { entries } = await import("../agent-sync.js");
    expect(entries("agent/").map(({ value }) => value)).toMatchObject([
      { id: cc, kind: "claude", settings: { model: "opus" } },
    ]);
    expect(entries("agent-device/").map(({ value }) => value)).toEqual([
      { binaryPath: "/opt/claude" },
    ]);
    expect((await getProviderSettings()).agents[0]?.settings).toEqual({
      model: "opus",
      binaryPath: "/opt/claude",
    });
  });

  it("sends a key as the account's, and the agent's removal with it", async () => {
    const brokk = (await service.addAgent("hermes")).id;
    await (await import("../agent/settings.js")).agentSecrets(brokk).set("key", "sk-brokk");
    expect(secrets.get(`agent:${brokk}:key`)).toBe("sk-brokk");
    const queued = () =>
      database
        .prepare("SELECT mutation FROM agent_outbox ORDER BY id")
        .all()
        .map((row) => JSON.parse(String(row.mutation)).op);
    expect(queued()).toEqual(["agent.set", "select", "secret.set"]);

    await service.removeAgent(brokk);
    expect(secrets.has(`agent:${brokk}:key`)).toBe(false);
    expect(queued()).toContain("agent.remove");
  });
});
