import { AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { fakeCore, settle, testPlatform } from "../testing.ts";
import { makeChatsStore, withTranscript, type Outgoing } from "./chats.ts";

const provider = { kind: "openclaw" };

function setup(chats: object[] = []) {
  const fake = fakeCore({
    "chats:list": () => ({ chats, device: { id: "here", name: "Here" } }),
    "chats:get": ({ id }) => ({ ...chats.find((c: any) => c.id === id), turns: [] }),
    "chats:save": () => undefined,
    "agent:send": () => ({ ok: true }),
    "agent:steer": () => ({ accepted: true }),
    "agent:resume": () => ({ resumed: true }),
    "agent:watch": () => ({ ok: true }),
    "agent:cancel": () => ({ ok: true }),
  });
  const registry = AtomRegistry.make();
  const store = makeChatsStore(registry, {
    core: fake.core,
    platform: testPlatform(),
    providerName: () => "OpenClaw",
    isProviderUsable: () => true,
    isFileLink: (href) => href.endsWith(".md"),
    mergeChanges: (changes) => changes,
    closeChatPages: () => {},
    showError: () => {},
    log: () => {},
  });
  return { fake, registry, store };
}

const message = (convoId: string, text: string, id = text): Outgoing => ({
  id,
  convoId,
  provider: "openclaw",
  question: text,
  input: text,
  title: text,
});

describe("chats", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    ctx.store.start();
    await settle();
  });

  const active = () =>
    ctx.store.get().conversations.find((c) => c.id === ctx.store.get().activeId)!;

  it("starts on a blank chat and streams a turn into it", async () => {
    const { store, fake, registry } = ctx;
    expect(store.get().ready).toBe(true);
    const convo = active();
    store.sendMessage(message(convo.id, "Hello"), "queue");
    const run = store.get().runs[convo.id];
    expect(run.provider).toBe("openclaw");
    expect(fake.called("agent:send")[0].params).toMatchObject({ input: "Hello", title: "Hello" });

    fake.emit("agent:chatEvent", { requestId: run.requestId, type: "delta", text: "Hi " });
    fake.emit("agent:chatEvent", { requestId: run.requestId, type: "delta", text: "there" });
    fake.emit("agent:chatEvent", { requestId: run.requestId, type: "done", responseId: "r1" });

    const turns = active().turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[1].items).toEqual([{ kind: "text", id: undefined, text: "Hi there" }]);
    expect(turns[1].finishedAt).toBeTypeOf("number");
    expect(store.get().runs[convo.id]).toBeUndefined();
    expect(registry.get(store.stateAtom).unseen.has(convo.id)).toBe(true);
  });

  it("queues a follow-up sent during a turn and starts it once the turn ends", () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "First"), "queue");
    const first = store.get().runs[convo.id].requestId;
    store.sendMessage(message(convo.id, "Second"), "queue");
    expect(store.get().queue.map((m) => m.question)).toEqual(["Second"]);
    expect(fake.called("agent:send")).toHaveLength(1);

    fake.emit("agent:chatEvent", { requestId: first, type: "done", responseId: null });
    expect(store.get().queue).toEqual([]);
    expect(fake.called("agent:send").map((c) => c.params.input)).toEqual(["First", "Second"]);
    expect(active().turns.find((t) => t.role === "user" && t.text === "Second")?.intent).toBe(
      "queued",
    );
  });

  it("steers a turn, and queues the message when the agent refuses it", async () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "First"), "steer");
    fake.answers["agent:steer"] = () => ({ accepted: false });
    store.sendMessage(message(convo.id, "Also this"), "steer");
    expect(active().turns.some((t) => t.text === "Also this")).toBe(true);
    await settle();
    expect(active().turns.some((t) => t.text === "Also this")).toBe(false);
    expect(store.get().queue.map((m) => m.question)).toEqual(["Also this"]);
  });

  it("follows a run the agent starts after a yield, once the turn running ends", async () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "Do it"), "queue");
    const run = store.get().runs[convo.id].requestId;
    fake.emit("agent:chatEvent", { requestId: run, type: "session", sessionId: "s1" });

    // The continuation starts while the first turn still runs: it waits for it.
    fake.emit("agent:runStarted", { provider: "openclaw", sessionId: "s1", requestId: "cont" });
    await settle();
    expect(fake.called("agent:resume")).toHaveLength(0);

    fake.emit("agent:chatEvent", { requestId: run, type: "done", responseId: null });
    await settle();
    expect(fake.called("agent:resume")[0].params).toEqual({
      provider: "openclaw",
      sessionId: "s1",
      requestId: "cont",
    });
    expect(store.get().runs[convo.id].requestId).toBe("cont");
    expect(active().turns.at(-1)).toMatchObject({ id: "a-cont", role: "assistant" });

    fake.emit("agent:chatEvent", { requestId: "cont", type: "text", id: "t", text: "Done!" });
    fake.emit("agent:chatEvent", { requestId: "cont", type: "done", responseId: null });
    expect(active().turns.map((t) => t.id)).toEqual([`u-${run}`, `a-${run}`, "a-cont"]);
    expect(store.get().runs[convo.id]).toBeUndefined();
  });

  it("leaves no turn for a run of the agent's own that said nothing", async () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "Hi"), "queue");
    const run = store.get().runs[convo.id].requestId;
    fake.emit("agent:chatEvent", { requestId: run, type: "session", sessionId: "s1" });
    fake.emit("agent:chatEvent", { requestId: run, type: "done", responseId: null });
    fake.emit("agent:runStarted", { provider: "openclaw", sessionId: "s1", requestId: "quiet" });
    await settle();
    fake.emit("agent:chatEvent", { requestId: "quiet", type: "done", responseId: null });
    expect(active().turns.some((t) => t.id === "a-quiet")).toBe(false);
    expect(store.get().runs[convo.id]).toBeUndefined();
  });

  it("watches this device's sessions with the agents that can run", async () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "Hi"), "queue");
    const run = store.get().runs[convo.id].requestId;
    fake.emit("agent:chatEvent", { requestId: run, type: "session", sessionId: "s1" });
    store.followProviders([provider]);
    await settle();
    expect(fake.called("agent:watch").at(-1)?.params).toEqual({
      provider: "openclaw",
      sessions: [{ id: "s1", since: Number.MAX_SAFE_INTEGER }],
    });
  });

  it("opens the files an answer links as tabs of the chat", () => {
    const { store, fake } = ctx;
    const convo = active();
    store.sendMessage(message(convo.id, "Write it"), "queue");
    const run = store.get().runs[convo.id].requestId;
    fake.emit("agent:chatEvent", {
      requestId: run,
      type: "text",
      id: "t",
      text: "See [the plan](notes/plan.md).",
    });
    fake.emit("agent:chatEvent", { requestId: run, type: "done", responseId: null });
    expect(active().tabs.map((t) => t.title)).toEqual(["the plan"]);
  });
});

describe("withTranscript", () => {
  it("keeps the id of a run's own turn when the record replaces it", () => {
    const turns = withTranscript(
      [
        { id: "u-1", role: "user", text: "Hi" },
        { id: "a-1", role: "assistant", text: "", items: [] },
        { id: "a-cont", role: "assistant", text: "", items: [], startedAt: 5 },
      ],
      "cont",
      [{ role: "assistant", text: "Back with results" }],
    );
    expect(turns.map((t) => t.id)).toEqual(["u-1", "a-1", "a-cont"]);
    expect(turns[2].items).toEqual([{ kind: "text", text: "Back with results" }]);
  });
});
