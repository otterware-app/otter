import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatListing } from "@otter/contracts/chats";
import type { Host, Notice } from "../host.ts";
import type { ChatEvent, ProviderSnapshot } from "./api.ts";

type Store = typeof import("./chat-store.ts");

const agent = {
  id: "agent-1",
  kind: "hermes",
  name: "Hermes",
  avatar: null,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: 1,
  models: [],
  model: null,
  sessions: true,
  forks: true,
  titles: true,
  liveBrowser: false,
  otherSessions: false,
  settings: { enabled: true, model: "" },
} satisfies ProviderSnapshot;

/** Core as the bridge shows it: what each channel answers, and what it broadcasts. */
function fakeBridge() {
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const answers: Record<string, (params: any) => unknown> = {
    "chats:list": () => ({ chats: [] as ChatListing[], device: { id: "mac", name: "Mac" } }),
    "chats:get": () => null,
    "agent:steer": () => ({ accepted: true }),
    "agent:resume": () => ({ resumed: true }),
  };
  const invoke = vi.fn(async (channel: string, params?: unknown) =>
    channel in answers ? answers[channel](params) : { ok: true },
  );
  return {
    answers,
    invoke,
    calls: (channel: string) =>
      invoke.mock.calls.filter(([c]) => c === channel).map(([, params]) => params as any),
    emit: (channel: string, params: unknown) =>
      listeners.get(channel)?.forEach((listener) => listener(params)),
    bridge: {
      platform: "test",
      features: {},
      invoke,
      on: (channel: string, listener: (params: unknown) => void) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(listener);
        listeners.set(channel, set);
        return () => set.delete(listener);
      },
    },
  };
}

function fakeHost(storage = new Map<string, string>()) {
  const leave = new Set<() => void>();
  const notices: Notice[] = [];
  let focused = true;
  const host: Host = {
    storage: {
      get: (key) => storage.get(key) ?? null,
      set: (key, value) => void storage.set(key, value),
    },
    focused: () => focused,
    onFocusChange: () => () => {},
    onLeave: (listener) => {
      leave.add(listener);
      return () => leave.delete(listener);
    },
    notice: (notice) => {
      notices.push(notice);
      return () => {};
    },
    agentMark: () => undefined,
  };
  return {
    host,
    storage,
    notices,
    leave: () => leave.forEach((listener) => listener()),
    setFocused: (value: boolean) => (focused = value),
  };
}

let core: ReturnType<typeof fakeBridge>;
let app: ReturnType<typeof fakeHost>;
let store: Store;

/** A fresh store, as on the app's launch, over what this device kept. */
async function launch(storage?: Map<string, string>): Promise<Store> {
  vi.resetModules();
  core = fakeBridge();
  app = fakeHost(storage);
  (globalThis as { desktopBridge?: unknown }).desktopBridge = core.bridge;
  const { setHost } = await import("../host.ts");
  setHost(app.host);
  const chats = await import("./chat-store.ts");
  chats.startChats();
  chats.followChats();
  chats.followAgents([agent]);
  await settle();
  return chats;
}

const settle = () => vi.advanceTimersByTimeAsync(0);

const chat = (id: string) => store.useChats.getState().conversations.find((c) => c.id === id)!;
const turn = (chatId: string, turnId: string) => chat(chatId).turns.find((t) => t.id === turnId)!;

function send(chatId: string, text: string, followUp: "queue" | "steer" = "queue") {
  store.sendMessage(
    {
      id: crypto.randomUUID(),
      convoId: chatId,
      provider: agent.id,
      question: text,
      input: text,
      title: store.clampTitle(text),
    },
    followUp,
  );
}

/** Starts a turn in a new chat: the chat and the turn's request id. */
async function running(text = "Hello there") {
  const id = store.newChat(agent.id);
  send(id, text);
  await settle();
  return { id, request: store.useChats.getState().runs[id].requestId };
}

const event = (e: ChatEvent) => core.emit("agent:chatEvent", e);

beforeEach(async () => {
  vi.useFakeTimers();
  store = await launch();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("the chat store", () => {
  it("starts a turn, names the chat, and follows its events to the finished reply", async () => {
    const { id, request } = await running("Plan my week");
    expect(core.calls("agent:send")).toEqual([
      expect.objectContaining({ provider: agent.id, requestId: request, input: "Plan my week" }),
    ]);
    expect(chat(id).title).toBe("Plan my week");
    expect(chat(id).openRequest).toBe(request);
    expect(chat(id).turns.map((t) => t.id)).toEqual([`u-${request}`, `a-${request}`]);

    event({ requestId: request, type: "session", sessionId: "s1" });
    event({ requestId: request, type: "delta", text: "Looking" });
    event({
      requestId: request,
      type: "tool",
      id: "t1",
      step: { kind: "read", title: "Calendar" },
    });
    event({ requestId: request, type: "toolResult", id: "t1", output: "3 events" });
    event({ requestId: request, type: "delta", text: "Three " });
    event({ requestId: request, type: "delta", text: "meetings." });
    event({ requestId: request, type: "done", responseId: null });

    expect(chat(id).sessionId).toBe("s1");
    const reply = turn(id, `a-${request}`);
    expect(reply.items).toEqual([
      { kind: "text", text: "Looking" },
      { kind: "step", id: "t1", step: { kind: "read", title: "Calendar" }, output: "3 events" },
      { kind: "text", text: "Three meetings." },
    ]);
    expect(reply.finishedAt).toBeTypeOf("number");
    expect(store.useChats.getState().runs[id]).toBeUndefined();
    expect(chat(id).openRequest).toBeNull();
    expect(store.useChats.getState().unseen.has(id)).toBe(true);
  });

  it("queues a follow-up until the turn ends, or steers the turn with it", async () => {
    const { id, request } = await running();
    send(id, "And then?");
    expect(store.useChats.getState().queue.map((m) => m.question)).toEqual(["And then?"]);
    expect(core.calls("agent:send")).toHaveLength(1);

    send(id, "Shorter, please", "steer");
    await settle();
    expect(core.calls("agent:steer")).toEqual([
      { provider: agent.id, requestId: request, input: "Shorter, please" },
    ]);
    expect(chat(id).turns.find((t) => t.text === "Shorter, please")?.intent).toBe("steer");

    event({ requestId: request, type: "done", responseId: null });
    await settle();
    expect(store.useChats.getState().queue).toEqual([]);
    expect(core.calls("agent:send").map((p) => p.input)).toEqual(["Hello there", "And then?"]);
  });

  it("queues a steer the agent refuses", async () => {
    const { id } = await running();
    core.answers["agent:steer"] = () => ({ accepted: false });
    send(id, "Shorter, please", "steer");
    await settle();
    expect(store.useChats.getState().queue.map((m) => m.question)).toEqual(["Shorter, please"]);
    expect(chat(id).turns.some((t) => t.text === "Shorter, please")).toBe(false);
  });

  it("sends a queued message into the turn, or edits it in the composer", async () => {
    const { id, request } = await running();
    store.setDraft(id, "half a thought");
    send(id, "Second");
    const queued = store.useChats.getState().queue[0];
    store.editQueued(queued.id);
    expect(store.useChats.getState().drafts[id]).toBe("Second");
    store.updateQueued(queued.id, "Second, edited");
    store.cancelQueuedEdit(id);
    expect(store.useChats.getState().drafts[id]).toBe("half a thought");

    store.steerQueued(queued.id);
    await settle();
    expect(core.calls("agent:steer")).toEqual([
      { provider: agent.id, requestId: request, input: "Second, edited" },
    ]);
    expect(chat(id).turns.find((t) => t.text === "Second, edited")?.intent).toBe("promoted");
  });

  it("asks for an approval and takes the answer", async () => {
    const { id, request } = await running();
    event({ requestId: request, type: "session", sessionId: "s1" });
    event({
      requestId: request,
      type: "approval",
      approval: { id: "ap1", kind: "command", title: "Run tests", choices: ["once", "deny"] },
    });
    expect(store.useChats.getState().approvals).toHaveLength(1);
    expect(core.calls("agent:notifyAsk")).toEqual([
      expect.objectContaining({ kind: "approval", title: "Run tests", chat: id, viewing: false }),
    ]);

    await store.respondApproval("ap1", "once");
    expect(core.calls("agent:respondApproval")).toEqual([
      { provider: agent.id, requestId: request, approvalId: "ap1", decision: "once" },
    ]);
    expect(store.useChats.getState().approvals).toEqual([]);
    expect(core.calls("agent:noteResolved")).toEqual([{ session: "s1", id: "approval:ap1" }]);
  });

  it("asks a question and takes the answer, or says it couldn't send it", async () => {
    const { request } = await running();
    const question = (id: string) =>
      event({
        requestId: request,
        type: "question",
        question: {
          id,
          expiresAt: Date.now() + 60_000,
          questions: [
            {
              id: "q",
              header: "Which?",
              question: "Pick one",
              options: [{ label: "A" }, { label: "B" }],
              multiSelect: false,
              secret: false,
            },
          ],
        },
      });
    question("qu1");
    expect(core.calls("agent:notifyAsk").at(-1)).toMatchObject({
      kind: "question",
      title: "Which?",
      options: ["A", "B"],
    });
    await store.answerQuestion("qu1", { q: ["A"] });
    expect(core.calls("agent:answerQuestion")).toEqual([
      { provider: agent.id, requestId: request, questionId: "qu1", answers: { q: ["A"] } },
    ]);
    expect(store.useChats.getState().questions).toEqual([]);

    question("qu2");
    core.answers["agent:answerQuestion"] = () => Promise.reject(new Error("gone"));
    await store.answerQuestion("qu2", null);
    expect(store.useChats.getState().questions).toHaveLength(1);
    expect(app.notices).toEqual([
      expect.objectContaining({ tone: "error", title: "Couldn't send the answer", body: "gone" }),
    ]);
  });

  it("shows an agent's notice in the app while it's in front, and closes it with its chat", async () => {
    const close = vi.fn();
    app.host.notice = (notice) => {
      app.notices.push(notice);
      return close;
    };
    const open = vi.fn();
    store.showAgentInAppNotice(
      { id: "n1", kind: "question", title: "A question", chat: "c1" },
      open,
    );
    expect(app.notices).toEqual([
      expect.objectContaining({ tone: "warning", title: "A question", timeout: 12_000 }),
    ]);
    app.notices[0].action!.run();
    expect(open).toHaveBeenCalledWith("c1");
    store.showChat("c1");
    expect(close).toHaveBeenCalled();
    expect(core.calls("agent:dismissNotification")).toEqual([{ chat: "c1" }]);

    app.setFocused(false);
    store.showAgentInAppNotice({ id: "n2", kind: "finished", title: "Done" }, open);
    expect(app.notices).toHaveLength(1);
  });

  it("stops a turn", async () => {
    const { id, request } = await running();
    store.stopRun(id);
    expect(core.calls("agent:cancel")).toEqual([{ provider: agent.id, requestId: request }]);
    event({ requestId: request, type: "error", message: "cancelled" });
    expect(turn(id, `a-${request}`).error).toBe("Stopped.");
    expect(store.useChats.getState().runs[id]).toBeUndefined();
    expect(store.useChats.getState().retries).toEqual({});
  });

  it("sends a failed message again in place of the failed exchange", async () => {
    const { id, request } = await running("Try this");
    event({ requestId: request, type: "error", message: "unreachable" });
    expect(turn(id, `a-${request}`).error).toBe("Can't reach Hermes. Are you on Tailscale?");
    expect(Object.keys(store.useChats.getState().retries)).toEqual([`a-${request}`]);

    store.retryTurn(`a-${request}`);
    await settle();
    const again = store.useChats.getState().runs[id].requestId;
    expect(again).not.toBe(request);
    expect(chat(id).turns.map((t) => t.id)).toEqual([`u-${again}`, `a-${again}`]);
    expect(core.calls("agent:send").map((p) => p.input)).toEqual(["Try this", "Try this"]);
    expect(store.useChats.getState().retries).toEqual({});
  });

  it("keeps drafts on the device and gives them back on the next launch", async () => {
    const id = store.newChat(agent.id);
    store.setDraft(id, "Dear team,");
    app.leave();
    expect(JSON.parse(app.storage.get("gmail:chat-drafts")!)).toEqual({ [id]: "Dear team," });

    const kept = app.storage;
    store = await launch(kept);
    expect(store.useChats.getState().drafts[id]).toBe("Dear team,");
    expect(chat(id)).toMatchObject({ provider: agent.id, turns: [] });
    expect(store.useChats.getState().activeId).toBe(id);
  });

  it("writes drafts a moment after typing stops", async () => {
    const id = store.newChat(agent.id);
    store.setDraft(id, "Dear");
    expect(app.storage.get("gmail:chat-drafts")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    expect(JSON.parse(app.storage.get("gmail:chat-drafts")!)).toEqual({ [id]: "Dear" });
  });

  it("picks a turn in flight up again on the next launch", async () => {
    const { id, request } = await running();
    event({ requestId: request, type: "session", sessionId: "s1" });
    const listing = { ...chat(id), turns: undefined } as unknown as ChatListing;
    const kept = app.storage;
    expect(JSON.parse(kept.get("gmail:chat-open-requests")!)).toEqual({ [id]: request });

    vi.resetModules();
    const next = fakeBridge();
    next.answers["chats:list"] = () => ({ chats: [listing], device: { id: "mac", name: "Mac" } });
    next.answers["chats:get"] = () => ({ ...listing, turns: chat(id).turns });
    core = next;
    app = fakeHost(kept);
    (globalThis as { desktopBridge?: unknown }).desktopBridge = next.bridge;
    (await import("../host.ts")).setHost(app.host);
    store = await import("./chat-store.ts");
    store.startChats();
    store.followChats();
    await settle();
    store.followAgents([agent]);
    await settle();
    expect(next.calls("agent:resume")).toEqual([
      { provider: agent.id, requestId: request, sessionId: "s1" },
    ]);
    expect(store.useChats.getState().runs[id].requestId).toBe(request);
  });

  it("shelves and pins chats", async () => {
    const { id, request } = await running();
    event({ requestId: request, type: "done", responseId: null });
    await store.pinChat(id, true);
    expect(chat(id).pinnedAt).toBeTypeOf("number");

    const later = Date.now() + 3_600_000;
    await store.shelveChat(id, { snoozedUntil: later, settledAt: null });
    expect(chat(id)).toMatchObject({ snoozedUntil: later, pinnedAt: null });

    await store.shelveChat(id, { snoozedUntil: null, settledAt: null });
    expect(chat(id).returnedAt).toBe(Date.now());

    await store.pinChat(id, true, 5);
    expect(chat(id)).toMatchObject({ pinnedAt: 5, snoozedUntil: null, settledAt: null });
    await store.pinChat(id, false);
    expect(chat(id).pinnedAt).toBeNull();
  });

  it("places what an agent delivers in its own chat, and notifies of it", async () => {
    core.emit("agent:runStarted", {
      provider: agent.id,
      sessionId: "cron:brief",
      requestId: "r9",
      chat: { title: "Morning brief" },
      deliveredAt: Date.now(),
      delivery: { kind: "automation", name: "Brief" },
    });
    await settle();
    const id = `${agent.id}-cron-brief`;
    expect(chat(id)).toMatchObject({ title: "Morning brief", sessionId: "cron:brief" });
    expect(turn(id, "a-r9").delivered).toEqual({ kind: "automation", name: "Brief" });
    expect(core.calls("agent:resume")).toEqual([
      expect.objectContaining({ provider: agent.id, sessionId: "cron:brief", requestId: "r9" }),
    ]);

    event({ requestId: "r9", type: "text", id: "x", text: "Three things today." });
    event({ requestId: "r9", type: "done", responseId: null });
    expect(turn(id, "a-r9").items).toEqual([
      { kind: "text", id: "x", text: "Three things today." },
    ]);
    expect(core.calls("agent:notifyAsk")).toEqual([
      expect.objectContaining({
        kind: "message",
        chat: id,
        taskName: "Brief",
        body: "Three things today.",
      }),
    ]);
  });

  it("drops a run of the agent's own that said nothing", async () => {
    core.emit("agent:runStarted", {
      provider: agent.id,
      sessionId: "quiet",
      requestId: "r0",
      chat: { title: "Quiet" },
    });
    await settle();
    const id = `${agent.id}-quiet`;
    event({ requestId: "r0", type: "done", responseId: null });
    expect(chat(id).turns).toEqual([]);
    expect(store.useChats.getState().runs[id]).toBeUndefined();
  });

  it("saves a chat to core a moment after it changes", async () => {
    const { id, request } = await running();
    event({ requestId: request, type: "done", responseId: null });
    await vi.advanceTimersByTimeAsync(1500);
    const [save] = core.calls("chats:save");
    expect(save.chat.id).toBe(id);
    expect(save.turnIds).toEqual([`u-${request}`, `a-${request}`]);
    expect(save.settled).toBe(true);
  });
});
