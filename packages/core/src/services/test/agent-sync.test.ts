import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyMutation,
  type AgentStore,
  type AgentSyncRequest,
  type AgentSyncResponse,
} from "@otter/contracts/agent-sync";
import type { Chat, ChatTurn } from "@otter/contracts/chats";

/** The relay, as infra/relay keeps it: an entry per key, numbered by the write that last changed it. */
const relay = {
  entries: new Map<string, { version: number; value: unknown }>(),
  head: 0,
  clients: new Map<string, number>(),
  down: false,
  /** The next request is applied, and its answer lost on the way back. */
  loseAnswer: false,
  page: 3,
};

const relayStore: AgentStore = {
  get: (key) => structuredClone(relay.entries.get(key)?.value),
  set: (key, value) =>
    void relay.entries.set(key, { version: ++relay.head, value: structuredClone(value) }),
  turnKeys: (chat) => [...relay.entries.keys()].filter((k) => k.startsWith(`turn/${chat}/`)),
  removeTurns: (chat) => {
    for (const key of relay.entries.keys())
      if (key.startsWith(`turn/${chat}/`)) relay.entries.delete(key);
  },
  deviceKeys: (agent) =>
    [...relay.entries.keys()].filter((k) => k.startsWith(`agent-device/${agent}/`)),
  secretKeys: (agent) => [...relay.entries.keys()].filter((k) => k.startsWith(`secret/${agent}/`)),
};

function exchange({ client, since, mutations }: AgentSyncRequest): AgentSyncResponse {
  const last = relay.clients.get(client) ?? 0;
  for (const { id, mutation } of mutations) if (id > last) applyMutation(relayStore, mutation);
  relay.clients.set(client, Math.max(last, ...mutations.map((m) => m.id)));
  const newer = [...relay.entries.entries()]
    .filter(([, e]) => e.version > since)
    .sort(([, a], [, b]) => a.version - b.version);
  const page = newer.slice(0, relay.page);
  const more = page.length < newer.length;
  return {
    version: more ? page.at(-1)![1].version : relay.head,
    lastMutationId: relay.clients.get(client)!,
    changes: structuredClone(page.map(([key, { value }]) => ({ key, value }))),
    more,
  };
}

class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const account = { user: { id: "u1", email: "me@example.com" } as { id: string } | null };

vi.mock("../otter-account.js", () => ({
  RelayError,
  OTTER_SIGNED_OUT_MESSAGE: "Signed out",
  getOtterUser: () => account.user,
  onOtterAccountChange: () => {},
  async relayRequest(_method: string, _route: string, body: AgentSyncRequest) {
    if (relay.down) throw new RelayError(0, "offline");
    const answer = exchange(structuredClone(body));
    if (relay.loseAnswer) {
      relay.loseAnswer = false;
      throw new RelayError(0, "connection reset");
    }
    return answer;
  },
}));

const hermes = {
  kind: "hermes",
  displayName: "Hermes",
  defaults: { enabled: true },
  fields: {},
  secrets: ["key"],
  create: () => ({ shutdown: () => {}, checkStatus: async () => ({}) }),
};
const openclaw = {
  ...hermes,
  kind: "openclaw",
  secrets: ["token", "device-key"],
  deviceSecrets: ["device-key"],
};
const claude = { ...hermes, kind: "claude", secrets: [], deviceFields: ["binaryPath"] };
vi.mock("../../extensions.js", () => ({
  registeredAgents: () =>
    new Map<string, unknown>([
      ["hermes", hermes],
      ["openclaw", openclaw],
      ["claude", claude],
    ]),
}));

/** A device of the account: its own database, secrets and files, and its own copy of core. */
async function device(files = new Map<string, string>(), database = new DatabaseSync(":memory:")) {
  vi.resetModules();
  const { setPlatform } = await import("../../platform.ts");
  const secrets = new Map<string, string>();
  const broadcasts: [string, unknown][] = [];
  setPlatform({
    broadcast: (channel: string, params: unknown) => broadcasts.push([channel, params]),
    log: () => {},
    deviceName: "Robin's Mac",
    database: () => database,
    files: {
      read: async (name: string) =>
        files.has(name) ? new TextEncoder().encode(files.get(name)) : null,
      write: async (name: string, data: Uint8Array | string) => void files.set(name, String(data)),
      remove: async (name: string) => void files.delete(name),
    },
    secrets: {
      get: async (name: string) => secrets.get(name) ?? null,
      set: async (name: string, value: string) => void secrets.set(name, value),
      delete: async (name: string) => void secrets.delete(name),
    },
  } as never);
  return {
    database,
    files,
    secrets,
    broadcasts,
    sync: await import("../agent-sync.ts"),
    chats: await import("../chats.ts"),
    settings: await import("../agent/settings.ts"),
    local: await import("../agent/local-import.ts"),
  };
}

type Device = Awaited<ReturnType<typeof device>>;

const chat = (id: string, patch: Partial<Chat> = {}): Chat => ({
  id,
  title: "Plan the offsite",
  provider: "hermes-1",
  sessionId: null,
  sessionOwned: false,
  lastResponseId: null,
  device: null,
  createdAt: 1,
  updatedAt: 10,
  tabs: [],
  turns: [{ id: "u-1", role: "user", text: "Find a venue" }],
  ...patch,
});

function save(on: Device, c: Chat, turns: ChatTurn[] = c.turns, settled = true) {
  const { turns: all, ...row } = c;
  return on.chats.saveChat({ chat: row, turnIds: all.map((t) => t.id), turns, settled });
}

/** Every device as the relay has it: its copy, read the way the app reads it. */
async function view(on: Device) {
  const { chats } = await on.chats.listChats();
  return {
    chats: await Promise.all(chats.map((c) => on.chats.getChat(c.id))),
    agents: await on.settings.getProviderSettings(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  relay.entries.clear();
  relay.clients.clear();
  relay.head = 0;
  relay.down = false;
  relay.loseAnswer = false;
  account.user = { id: "u1" };
});

describe("agent sync", () => {
  it("gives another device a chat whole, every turn as it was written", async () => {
    const mac = await device();
    const web = await device();
    const turns: ChatTurn[] = Array.from({ length: 150 }, (_, i) => ({
      id: `t-${i}`,
      role: i % 2 ? "assistant" : "user",
      text: `message ${i}`,
      items: [{ kind: "step", step: { kind: "command", title: "ls" }, output: "x".repeat(6000) }],
    }));
    await save(mac, chat("c1", { turns }));
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    expect(await web.chats.getChat("c1")).toEqual(await mac.chats.getChat("c1"));
    expect((await web.chats.getChat("c1"))?.turns).toHaveLength(150);
    expect(web.broadcasts).toContainEqual(["chats:changed", { ids: ["c1"] }]);
    expect(await web.chats.searchChats("message 149")).toMatchObject([
      { id: "c1", turnId: "t-149" },
    ]);
  });

  it("keeps both of two changes made apart, and both devices end the same", async () => {
    const mac = await device();
    const web = await device();
    await save(mac, chat("c1"));
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    relay.down = true;
    await save(mac, chat("c1", { title: "Offsite in May", updatedAt: 20 }));
    await save(
      web,
      chat("c1", {
        pinnedAt: 30,
        updatedAt: 30,
        turns: [...chat("c1").turns, { id: "a-1", role: "assistant", text: "Cedar Hall" }],
      }),
      [{ id: "a-1", role: "assistant", text: "Cedar Hall" }],
    );
    // Each device shows its own change at once, offline.
    expect((await mac.chats.getChat("c1"))?.title).toBe("Offsite in May");
    expect((await web.chats.getChat("c1"))?.pinnedAt).toBe(30);

    relay.down = false;
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();
    await mac.sync.syncAgentData();
    const both = await view(mac);
    expect(await view(web)).toEqual(both);
    expect(both.chats[0]).toMatchObject({ title: "Offsite in May", pinnedAt: 30 });
    expect(both.chats[0]?.turns.map((t) => t.id)).toEqual(["u-1", "a-1"]);
  });

  it("puts turns two devices add at once in one order on both", async () => {
    const mac = await device();
    const web = await device();
    await save(mac, chat("c1"));
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    const add = (on: Device, id: string) =>
      save(on, chat("c1", { turns: [...chat("c1").turns, { id, role: "user", text: id }] }), [
        { id, role: "user", text: id },
      ]);
    await add(mac, "from-mac");
    await add(web, "from-web");
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();
    await mac.sync.syncAgentData();

    const order = (await mac.chats.getChat("c1"))?.turns.map((t) => t.id);
    expect(order).toEqual(["u-1", "from-mac", "from-web"]);
    expect((await web.chats.getChat("c1"))?.turns.map((t) => t.id)).toEqual(order);
  });

  it("lets a deleted chat go everywhere, even from a device still writing to it", async () => {
    const mac = await device();
    const web = await device();
    await save(mac, chat("c1"));
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    await mac.chats.deleteChat("c1");
    await save(web, chat("c1", { title: "Still going", updatedAt: 99 }));
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    expect((await view(web)).chats).toEqual([]);
    expect((await view(mac)).chats).toEqual([]);
  });

  it("sends a streaming turn's latest as one change, not each step", async () => {
    const mac = await device();
    await save(mac, chat("c1"));
    await mac.sync.syncAgentData();
    const sent = relay.head;
    for (let i = 1; i <= 20; i++) {
      const reply = { id: "a-1", role: "assistant" as const, text: "word ".repeat(i) };
      await save(mac, chat("c1", { turns: [...chat("c1").turns, reply] }), [reply], false);
    }
    expect(mac.database.prepare("SELECT count(*) AS n FROM agent_outbox").get()?.n).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(relay.head - sent).toBe(1);
    expect(relay.entries.get("turn/c1/a-1")?.value).toMatchObject({
      turn: { text: "word ".repeat(20) },
    });
  });

  it("gives the account's devices its agents, their keys, and each device its own fields", async () => {
    const mac = await device();
    const web = await device();
    await mac.settings.saveProviderSettings({
      selected: "h1",
      agents: [
        {
          id: "h1",
          kind: "hermes",
          name: "Brokk",
          settings: { enabled: true, baseUrl: "x" } as never,
        },
        {
          id: "cc",
          kind: "claude",
          name: "Claude",
          settings: { binaryPath: "/opt/claude" } as never,
        },
        { id: "oc", kind: "openclaw", name: "Claw", settings: { url: "wss://claw" } as never },
      ],
    });
    await mac.settings.agentSecrets("h1").set("key", "sk-brokk");
    await mac.settings.agentSecrets("oc", openclaw.deviceSecrets).set("token", "gateway-token");
    await mac.settings.agentSecrets("oc", openclaw.deviceSecrets).set("device-key", "mac-only");
    await mac.sync.syncAgentData();
    await web.sync.syncAgentData();

    const { agents, selected } = await web.settings.getProviderSettings();
    expect(selected).toBe("h1");
    expect(agents.map((a) => [a.id, a.name, a.settings])).toEqual([
      ["h1", "Brokk", { enabled: true, baseUrl: "x" }],
      ["cc", "Claude", {}],
      ["oc", "Claw", { url: "wss://claw" }],
    ]);
    expect(web.secrets.get("agent:h1:key")).toBe("sk-brokk");
    expect(web.secrets.get("agent:oc:token")).toBe("gateway-token");
    expect(web.secrets.has("agent:oc:device-key")).toBe(false);
    expect(JSON.stringify([...relay.entries])).not.toContain("mac-only");

    // Removed on one, gone on both, with its keys.
    const { agents: all } = await web.settings.getProviderSettings();
    await web.settings.saveProviderSettings({
      selected: null,
      agents: all.filter((a) => a.id !== "h1"),
    });
    await web.sync.syncAgentData();
    await mac.sync.syncAgentData();
    expect((await mac.settings.getProviderSettings()).agents.map((a) => a.id)).toEqual([
      "cc",
      "oc",
    ]);
    expect(mac.secrets.has("agent:h1:key")).toBe(false);
    expect((await mac.settings.getProviderSettings()).agents[0]?.settings).toEqual({
      binaryPath: "/opt/claude",
    });
  });

  it("shows nothing without the account, and starts over for another", async () => {
    const mac = await device();
    await save(mac, chat("c1"));
    await mac.settings.saveProviderSettings({
      selected: null,
      agents: [{ id: "h1", kind: "hermes", name: "Brokk", settings: {} as never }],
    });
    await mac.settings.agentSecrets("h1").set("key", "sk-brokk");
    await mac.sync.syncAgentData();

    account.user = null;
    expect(await view(mac)).toEqual({ chats: [], agents: { selected: null, agents: [] } });

    account.user = { id: "u1" };
    expect((await view(mac)).chats).toHaveLength(1);

    relay.entries.clear();
    account.user = { id: "u2" };
    await mac.sync.syncAgentData();
    expect((await view(mac)).chats).toEqual([]);
    expect(mac.secrets.has("agent:h1:key")).toBe(false);
  });

  it("sends what this device kept before to the account once, keeping the chats' device", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE chats (id TEXT PRIMARY KEY, updatedAt INTEGER NOT NULL, chat TEXT NOT NULL);
      CREATE TABLE chat_turns (chatId TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
        role TEXT NOT NULL, text TEXT NOT NULL, turn TEXT NOT NULL, PRIMARY KEY (chatId, id));
      CREATE TABLE chat_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const { turns, ...row } = chat("old", { device: { id: "dev-1", name: "Mac" } });
    database.prepare("INSERT INTO chats VALUES (?, ?, ?)").run("old", 10, JSON.stringify(row));
    turns.forEach((t, i) =>
      database
        .prepare("INSERT INTO chat_turns VALUES (?, ?, ?, ?, ?, ?)")
        .run("old", t.id, i, t.role, t.text, JSON.stringify(t)),
    );
    database
      .prepare("INSERT INTO chat_state VALUES ('device', ?)")
      .run(JSON.stringify({ id: "dev-1" }));
    const files = new Map([
      [
        "agents.json",
        JSON.stringify({
          selected: "cc",
          agents: [{ id: "cc", kind: "claude", name: "Claude", settings: { binaryPath: "/x" } }],
          removed: ["gone"],
        }),
      ],
    ]);
    const mac = await device(files, database);
    await mac.local.importLocalAgentData();
    await mac.sync.syncAgentData();

    expect(mac.sync.deviceId()).toBe("dev-1");
    expect(files.has("agents.json")).toBe(false);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE name IN ('chats', 'chat_turns')")
        .all(),
    ).toEqual([]);
    const web = await device();
    await web.sync.syncAgentData();
    expect((await web.chats.getChat("old"))?.turns).toEqual(turns);
    expect((await web.settings.getProviderSettings()).selected).toBe("cc");
    expect(relay.entries.get("agent-device/cc/dev-1")?.value).toEqual({ binaryPath: "/x" });
    expect(relay.entries.get("agent/gone")?.value).toBeNull();
    await mac.local.importLocalAgentData();
    expect(relay.entries.get("chat/old")?.version).toBeLessThan(relay.head + 1);
  });

  it("sends a long chat in parts the relay takes, and every part arrives", async () => {
    const mac = await device();
    const turns: ChatTurn[] = ["a", "b", "c"].map((id) => ({
      id,
      role: "assistant",
      text: id.repeat(600_000),
    }));
    await save(mac, chat("c1", { turns }));
    const rows = mac.database.prepare("SELECT mutation FROM agent_outbox").all();
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) expect(String(row.mutation).length).toBeLessThanOrEqual(1_000_000);
    await mac.sync.syncAgentData();
    expect(["a", "b", "c"].map((id) => relay.entries.has(`turn/c1/${id}`))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps a change made after a send whose answer was lost", async () => {
    const mac = await device();
    const reply = (text: string): ChatTurn => ({ id: "a-1", role: "assistant", text });
    await save(mac, chat("c1", { turns: [reply("first")] }));
    relay.loseAnswer = true;
    await mac.sync.syncAgentData();
    await save(mac, chat("c1", { turns: [reply("second")] }), [reply("second")], false);
    await mac.sync.syncAgentData();
    expect(relay.entries.get("turn/c1/a-1")?.value).toMatchObject({ turn: { text: "second" } });
  });

  it("uploads what a device kept before without writing over what the account has since", async () => {
    const web = await device();
    const done: ChatTurn = {
      id: "a-1",
      role: "assistant",
      text: "",
      items: [{ kind: "step", step: { kind: "command", title: "ls" }, output: "abc…" }],
      finishedAt: 20,
    };
    await save(web, chat("c1", { updatedAt: 20, turns: [...chat("c1").turns, done] }));
    await web.sync.syncAgentData();

    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE chats (id TEXT PRIMARY KEY, updatedAt INTEGER NOT NULL, chat TEXT NOT NULL);
      CREATE TABLE chat_turns (chatId TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
        role TEXT NOT NULL, text TEXT NOT NULL, turn TEXT NOT NULL, PRIMARY KEY (chatId, id));
    `);
    const older = chat("c1", {
      updatedAt: 10,
      turns: [
        { id: "u-0", role: "user", text: "Earlier, before the relay's last turns" },
        ...chat("c1").turns,
        {
          ...done,
          text: "partial",
          items: [{ kind: "step", step: { kind: "command", title: "ls" }, output: "abcdef" }],
          finishedAt: undefined,
        },
      ],
    });
    const { turns, ...row } = older;
    database.prepare("INSERT INTO chats VALUES (?, ?, ?)").run("c1", 10, JSON.stringify(row));
    turns.forEach((t, i) =>
      database
        .prepare("INSERT INTO chat_turns VALUES (?, ?, ?, ?, ?, ?)")
        .run("c1", t.id, i, t.role, t.text, JSON.stringify(t)),
    );
    const mac = await device(new Map(), database);
    await mac.local.importLocalAgentData();
    await mac.sync.syncAgentData();

    const got = await mac.chats.getChat("c1");
    expect(got?.updatedAt).toBe(20);
    expect(got?.turns.map((t) => t.id)).toEqual(["u-0", "u-1", "a-1"]);
    // The account's answer stays, with the whole output this device had.
    expect(got?.turns[2]).toEqual({
      ...done,
      items: [{ kind: "step", step: { kind: "command", title: "ls" }, output: "abcdef" }],
    });
  });

  it("moves a chat that names its kind, from before agents had ids, to the account's agent of that kind", async () => {
    const mac = await device();
    const web = await device();
    await save(mac, chat("old", { provider: "openclaw" }));
    await save(mac, chat("gone", { provider: "codex" }));
    await mac.settings.saveProviderSettings({
      selected: null,
      agents: [{ id: "oc", kind: "openclaw", name: "Claw", settings: {} as never }],
    });
    await mac.sync.syncAgentData();
    await vi.advanceTimersByTimeAsync(400);
    await web.sync.syncAgentData();

    expect((await web.chats.getChat("old"))?.provider).toBe("oc");
    // No agent of that kind: it waits for one.
    expect((await web.chats.getChat("gone"))?.provider).toBe("codex");
  });
});
