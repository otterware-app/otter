import { describe, expect, it } from "vite-plus/test";
import {
  applyMutation,
  fitTurn,
  type AgentMutation,
  type AgentStore,
  type TurnRecord,
} from "@otter/contracts/agent-sync";
import type { ChatTurn } from "@otter/contracts/chats";

/** The entries a copy keeps, applied to as the relay and every device apply them. */
function copy() {
  const entries = new Map<string, unknown>();
  const under = (prefix: string) => [...entries.keys()].filter((k) => k.startsWith(prefix));
  const store: AgentStore = {
    get: (key) => entries.get(key),
    set: (key, value) => void entries.set(key, structuredClone(value)),
    turnKeys: (chat) => under(`turn/${chat}/`),
    removeTurns: (chat) => under(`turn/${chat}/`).forEach((key) => entries.delete(key)),
    deviceKeys: (agent) => under(`agent-device/${agent}/`),
    secretKeys: (agent) => under(`secret/${agent}/`),
  };
  return {
    get: store.get,
    apply: (...mutations: AgentMutation[]) => mutations.forEach((m) => applyMutation(store, m)),
    turns: (chat: string) =>
      store
        .turnKeys(chat)
        .map((key) => entries.get(key) as TurnRecord | null)
        .filter((record): record is TurnRecord => !!record)
        .sort((a, b) => a.position - b.position)
        .map((record) => record.turn.id),
  };
}

const turn = (id: string, text = ""): ChatTurn => ({ id, role: "user", text });
const newChat = (id: string, title = "Plan the offsite"): AgentMutation => ({
  op: "chat.set",
  chat: { id, title, provider: "hermes-1", createdAt: 1, updatedAt: 10 },
});
const turns = (
  chat: string,
  put: ChatTurn[],
  order: string[],
  more: { removed?: string[]; imported?: true } = {},
): AgentMutation => ({ op: "turns", chat, put, order, ...more });

describe("a chat's entries", () => {
  it("keep a turn written elsewhere where it was, and what followed a removed turn after the one before", () => {
    const c = copy();
    c.apply(
      newChat("c"),
      turns("c", [turn("u1"), turn("a1")], ["u1", "a1"]),
      // Another device adds x after a1; this one, not knowing of it, adds u2.
      turns("c", [turn("x")], ["u1", "a1", "x"]),
      turns("c", [turn("u2")], ["u1", "a1", "u2"]),
    );
    expect(c.turns("c")).toEqual(["u1", "a1", "x", "u2"]);

    c.apply(turns("c", [], ["u1", "u2"], { removed: ["a1"] }));
    expect(c.turns("c")).toEqual(["u1", "x", "u2"]);
    expect(c.get("turn/c/a1")).toBeNull();
  });

  it("need a new chat's agent and when it was made, and a deleted chat stays gone", () => {
    const c = copy();
    c.apply({ op: "chat.set", chat: { id: "n", title: "no provider" } });
    expect(c.get("chat/n")).toBeUndefined();

    c.apply(newChat("c"), turns("c", [turn("u1")], ["u1"]), { op: "chat.delete", id: "c" });
    expect(c.get("chat/c")).toBeNull();
    expect(c.turns("c")).toEqual([]);
    c.apply(newChat("c", "Still going"), turns("c", [turn("u2")], ["u2"]));
    expect(c.get("chat/c")).toBeNull();
    expect(c.turns("c")).toEqual([]);
  });

  it("take back, on an import, only what the old copy cut, and keep removed turns removed", () => {
    const c = copy();
    const whole = "x".repeat(5000);
    const answer = (text: string, output: string, thumb?: string): ChatTurn => ({
      id: "a1",
      role: "assistant",
      text,
      attachments: [{ name: "plan.png", kind: "image", size: 1, ...(thumb && { thumb }) }],
      items: [{ kind: "step", step: { kind: "command", title: "ls" }, output }],
    });
    c.apply(
      newChat("c"),
      turns(
        "c",
        [turn("u1"), answer("Edited elsewhere", `${"x".repeat(2000)}…`), turn("u2")],
        ["u1", "a1", "u2"],
      ),
      turns("c", [], ["u1", "a1"], { removed: ["u2"] }),
      turns(
        "c",
        [
          turn("u1", "kept here"),
          answer("As it was", whole, "data:image/png;base64,AAAA"),
          turn("u2"),
          turn("u3"),
        ],
        ["u1", "a1", "u2", "u3"],
        { imported: true },
      ),
    );
    const a1 = (c.get("turn/c/a1") as TurnRecord).turn;
    expect((c.get("turn/c/u1") as TurnRecord).turn.text).toBe("");
    expect(a1.text).toBe("Edited elsewhere");
    expect(a1.items?.[0]).toMatchObject({ output: whole });
    expect(a1.attachments?.[0].thumb).toBe("data:image/png;base64,AAAA");
    expect(c.get("turn/c/u2")).toBeNull();
    expect(c.turns("c")).toEqual(["u1", "a1", "u3"]);
  });
});

describe("an agent's entries", () => {
  it("merge its settings, need its name to start, and go whole when it's removed", () => {
    const c = copy();
    c.apply({ op: "agent.set", id: "h", kind: "hermes", settings: { x: true } });
    expect(c.get("agent/h")).toBeUndefined();

    const picture = "data:image/png;base64,AAAA";
    c.apply(
      {
        op: "agent.set",
        id: "h",
        kind: "hermes",
        name: "brokk",
        avatar: picture,
        settings: { baseUrl: "x", enabled: true },
        addedAt: 3,
      },
      { op: "agent.set", id: "h", kind: "hermes", settings: { enabled: false }, addedAt: 9 },
      { op: "agent.device", id: "h", device: "phone", settings: { path: "/a" } },
      { op: "secret.set", agent: "h", name: "key", value: "sealed" },
      { op: "select", id: "h" },
    );
    expect(c.get("agent/h")).toEqual({
      id: "h",
      kind: "hermes",
      name: "brokk",
      avatar: picture,
      settings: { baseUrl: "x", enabled: false },
      addedAt: 3,
    });
    expect(c.get("agent-device/h/phone")).toEqual({ path: "/a" });
    c.apply({ op: "agent.set", id: "h", kind: "hermes", avatar: null });
    expect(c.get("agent/h")).not.toHaveProperty("avatar");

    c.apply({ op: "agent.remove", id: "h" });
    for (const key of ["agent/h", "agent-device/h/phone", "secret/h/key", "selected"])
      expect(c.get(key)).toBeNull();
    c.apply({ op: "agent.set", id: "h", kind: "hermes", name: "brokk" });
    expect(c.get("agent/h")).toBeNull();
  });
});

describe("a turn too big to keep", () => {
  it("gives up its steps' outputs first", () => {
    const big: ChatTurn = {
      id: "a1",
      role: "assistant",
      text: "Done",
      items: Array.from({ length: 300 }, () => ({
        kind: "step" as const,
        step: { kind: "command", title: "ls" },
        output: "x".repeat(5000),
      })),
    };
    const fitted = fitTurn(big);
    expect(fitted.items?.[0]).toMatchObject({ output: `${"x".repeat(2000)}…` });
    expect(fitted.text).toBe("Done");
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(1_000_000);
    const small: ChatTurn = { id: "a2", role: "assistant", text: "Hi" };
    expect(fitTurn(small)).toBe(small);
  });
});
