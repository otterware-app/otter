import type {
  Answer,
  Approval,
  Question,
  RoutineList,
  ThreadList,
  Model,
  ModelCatalog,
  ReasoningLevel,
  ThreadView,
  TranscriptItem,
  TurnEvent,
} from "@generalpursuit/varys";
import type { AgentRun, ChatEvent } from "@otter/core/extension-kit";
import { errAsync, ok, okAsync, err, type ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { VarysSettings } from "./settings.js";

vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({ kind: "desktop", appVersion: "test", log: () => {} }),
}));
vi.mock("../../../packages/core/src/services/agent/settings.js", () => ({
  getVarysToken: async () => "varys-token",
}));
/** A varys agent as the SDK shows it, played by the test. */
const agent = vi.hoisted(() => ({ fake: null as unknown as ReturnType<typeof fakeVarys> }));
vi.mock("@generalpursuit/varys", () => ({ connect: () => ok(agent.fake.varys) }));

const { varysProvider } = await import("./varys.js");

const settings = {
  enabled: true,
  model: "",
  address: "https://mac.tail1234.ts.net",
  agentId: "agent-1",
  installation: "install-1",
} as VarysSettings;

type Listener = (event: TurnEvent) => void;

function following(listener: Listener) {
  let resolve!: (result: unknown) => void;
  const ended = new Promise((r) => (resolve = r));
  return {
    listener,
    resolve,
    handle: {
      ended,
      close: () => resolve(err({ code: "closed", message: "This varys client was closed." })),
    },
  };
}

function fakeVarys() {
  const turns = new Map<string, ReturnType<typeof following>>();
  const follows = new Map<string, ReturnType<typeof following>>();
  const views = new Map<string, ThreadView>();
  const lists: { threads?: (list: unknown) => void; routines?: (list: unknown) => void } = {};
  const receipt = (threadId: string) => (input: { requestId?: string }) =>
    okAsync({ requestId: input.requestId ?? "auto", result: { threadId } });
  const varys = {
    agentId: "agent-1",
    me: () =>
      okAsync({
        credential: "grant",
        id: "g1",
        name: "Otter on the web",
        actsAs: "client",
        scopes: ["threads:read", "threads:write", "inbox", "routines:read", "routines:write"],
      }),
    receipt: vi.fn((requestId: string) =>
      requestId === "lost"
        ? errAsync({ code: "RECEIPT_NOT_FOUND", message: "No such command." })
        : okAsync({ requestId }),
    ),
    threads: {
      start: vi.fn((input: { id: string; requestId?: string }) => receipt(input.id)(input)),
      send: vi.fn((id: string, input: { requestId?: string }) => receipt(id)(input)),
      steer: vi.fn((id: string, input: { requestId?: string }) => receipt(id)(input)),
      stop: vi.fn((id: string) => receipt(id)({})),
      setModel: vi.fn(
        (id: string) => receipt(id)({}) as ResultAsync<unknown, { code: string; message: string }>,
      ),
      rename: vi.fn((id: string) => receipt(id)({})),
      upload: vi.fn(() => okAsync({ attachmentId: "file-1" })),
      read: vi.fn((id: string) =>
        views.has(id)
          ? okAsync(views.get(id)!)
          : errAsync({ code: "view_refused", message: "There's no such thread." }),
      ),
      older: vi.fn(() => okAsync({ items: [], earlier: false })),
      list: vi.fn(() => okAsync({ threads: [] as Partial<ThreadList["threads"][number]>[] })),
      turn: (_id: string, requestId: string, listener: Listener) => {
        const turn = following(listener);
        turns.set(requestId, turn);
        return {
          ended: turn.handle.ended,
          close: () => {
            turns.delete(requestId);
            turn.handle.close();
          },
        };
      },
      follow: (id: string, listener: Listener) => {
        const follow = following(listener);
        follows.set(id, follow);
        return follow.handle;
      },
      watchList: (listener: (list: unknown) => void) => {
        lists.threads = listener;
        return () => {};
      },
      watch: () => () => {},
    },
    inbox: {
      decide: vi.fn(() => okAsync({})),
      answer: vi.fn(() => okAsync({})),
    },
    routines: {
      watchList: (listener: (list: unknown) => void) => {
        lists.routines = listener;
        return () => {};
      },
    },
    models: {
      list: vi.fn(
        () => okAsync(catalog) as ResultAsync<unknown, { code: string; message: string }>,
      ),
      watchSettings: () => () => {},
    },
    skills: {
      list: () => okAsync([{ name: "invoices", description: "Files invoices in Drive." }]),
    },
    close: async () => {},
  };
  return {
    varys,
    views,
    /** Until varys's lists are watched. */
    watching: () => vi.waitFor(() => expect(lists.threads && lists.routines).toBeDefined()),
    /** Plays events into the turn a message sent with `requestId` started. */
    async play(requestId: string, events: TurnEvent[]) {
      await vi.waitFor(() => expect(turns.has(requestId)).toBe(true));
      const turn = turns.get(requestId)!;
      for (const event of events) turn.listener(event);
      const end = events.at(-1);
      if (end && ["done", "stopped", "failed"].includes(end.type)) turn.resolve(ok(end));
    },
    followed: (threadId: string) => follows.has(threadId),
    async playThread(threadId: string, events: TurnEvent[]) {
      await vi.waitFor(() => expect(follows.has(threadId)).toBe(true));
      for (const event of events) follows.get(threadId)!.listener(event);
    },
    showThreads(threads: Partial<ThreadList["threads"][number]>[]) {
      lists.threads?.({ status: "fresh", value: { threads, total: threads.length } });
    },
    showRoutines(routines: RoutineList["routines"]) {
      lists.routines?.({ status: "fresh", value: { routines, total: routines.length } });
    },
  };
}

const model = { provider: "rehearsal", id: "rehearsal", name: "Rehearsal", reasoning: null };
const modelOf = (id: string, reasoningLevels: ReasoningLevel[], fastMode: boolean) =>
  ({
    provider: "rehearsal",
    providerName: "Rehearsal",
    id,
    name: id,
    reasoningLevels,
    fastMode,
  }) as Model;
const catalog: ModelCatalog = {
  models: [
    modelOf("rehearsal-quick", ["off"], false),
    modelOf("rehearsal-deep", ["off", "low", "high"], true),
  ],
  default: {
    model: { provider: "rehearsal", model: "rehearsal-quick" },
    reasoning: "off",
    fast: false,
  },
};
const answer = (id: string, text: string, calls: Answer["calls"] = []): Answer => ({
  type: "answer",
  id,
  text,
  calls,
  model,
  origin: null,
});
const said = (id: string, text: string, at?: string): TranscriptItem => ({
  type: "message",
  id,
  text,
  stopped: false,
  ...(at && { at }),
});
function view(
  id: string,
  items: TranscriptItem[],
  routine: ThreadView["routine"] = null,
): ThreadView {
  return {
    id,
    title: "Dinner with Ann",
    routine,
    mode: "standard",
    model: null,
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
    queueHeld: false,
    conversation: {
      loaded: true,
      items,
      earlier: false,
      running: null,
      waiting: false,
      queued: [],
      failure: null,
    },
  };
}

const approval: Approval = {
  type: "approval",
  id: "a1",
  threadId: "t1",
  urgency: "high",
  deadline: null,
  batch: null,
  askedAt: "2026-11-09T10:00:05.000Z",
  headline: "Send an email to Ann",
  tool: "mail_send",
  presentation: {
    title: "Send an email",
    why: "It reaches outside.",
    runtime: null,
    fields: [{ label: "To", value: "ann@example.com" }],
  },
  input: "{}",
  effect: "outward",
  why: "It reaches outside.",
  destinations: ["ann@example.com"],
  attachments: [],
  authority: "owner",
  offer: { kind: "action", subject: "mail_send" },
  needsApp: false,
};
const question: Question = {
  type: "question",
  id: "q1",
  threadId: "t1",
  urgency: "normal",
  deadline: null,
  batch: null,
  askedAt: "2026-11-09T10:00:05.000Z",
  text: "Which day works best?",
};

function replies(events: ChatEvent[]): string[] {
  const text = new Map<string, string>();
  for (const event of events) {
    if (event.type === "delta") text.set(event.id!, (text.get(event.id!) ?? "") + event.text);
    else if (event.type === "text") text.set(event.id, event.text);
  }
  return [...text.values()].filter(Boolean);
}

let fake: ReturnType<typeof fakeVarys>;
beforeEach(() => {
  fake = agent.fake = fakeVarys();
});
afterEach(() => varysProvider.shutdown());

function send(input: { requestId?: string; sessionId?: string } = {}, picked = settings) {
  const events: ChatEvent[] = [];
  const sending = varysProvider.sendTurn(
    { requestId: "req-1", input: "Draft a friendly yes", sessionId: "t1", ...input } as never,
    picked,
    (event) => events.push(event),
  );
  return { events, sending };
}

describe("varys turns", () => {
  it("sends your message with Otter's request id, and streams the turn it starts", async () => {
    const { events, sending } = send();
    await fake.play("req-1", [
      { type: "started", since: null },
      { type: "message", message: said("admitted:req-1", "Draft a friendly yes") as never },
      { type: "text", delta: "Let me " },
      { type: "text", delta: "look." },
      {
        type: "step",
        call: {
          callId: "c1",
          tool: "read",
          summary: "Reads notes.md",
          detail: "notes.md",
          parent: null,
        },
      },
      {
        type: "answer",
        answer: answer("3", "Let me look.", [
          { id: "c1", tool: "read", summary: "Reads notes.md", detail: "notes.md" },
        ]),
      },
      {
        type: "result",
        result: {
          type: "result",
          id: "4",
          callId: "c1",
          tool: "read",
          failed: false,
          text: "eggs",
        },
      },
      { type: "text", delta: "Fried rice." },
      { type: "answer", answer: answer("5", "Fried rice.") },
      { type: "done" },
    ]);
    await sending;
    expect(fake.varys.threads.send).toHaveBeenCalledWith("t1", {
      requestId: "req-1",
      text: "Draft a friendly yes",
    });
    expect(replies(events)).toEqual(["Let me look.", "Fried rice."]);
    expect(events.find((e) => e.type === "tool")).toEqual({
      requestId: "req-1",
      type: "tool",
      id: "c1",
      step: { kind: "read", title: "Reads notes.md", detail: "notes.md" },
    });
    expect(events.find((e) => e.type === "toolResult")).toMatchObject({ id: "c1", output: "eggs" });
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "done", responseId: null });
  });

  it("starts a thread for a new chat, and names the chat as varys does", async () => {
    fake.views.set("new", view("new", []));
    fake.varys.threads.start.mockImplementationOnce((input) => {
      fake.views.set(input.id, view(input.id, []));
      return okAsync({ requestId: input.requestId!, result: { threadId: input.id } });
    });
    const { events, sending } = send({ sessionId: undefined });
    await fake.play("req-1", [{ type: "started", since: null }, { type: "done" }]);
    await sending;
    const threadId = (events.find((e) => e.type === "session") as { sessionId: string }).sessionId;
    expect(fake.varys.threads.start).toHaveBeenCalledWith({
      id: threadId,
      requestId: "req-1",
      text: "Draft a friendly yes",
    });
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "title", title: "Dinner with Ann" });
  });

  it("offers varys's skills, and names the one you pick in your message", async () => {
    expect(await varysProvider.listSkills(settings)).toEqual([
      { name: "invoices", description: "Files invoices in Drive.", category: null },
    ]);
    const events: ChatEvent[] = [];
    const sending = varysProvider.sendTurn(
      { requestId: "req-1", input: "This month's", sessionId: "t1", skill: { name: "invoices" } },
      settings,
      (event) => events.push(event),
    );
    await fake.play("req-1", [{ type: "done" }]);
    await sending;
    expect(fake.varys.threads.send).toHaveBeenCalledWith("t1", {
      requestId: "req-1",
      text: "Use the skill `invoices`.\n\nThis month's",
    });
  });

  it("shows varys's own message when it refuses a message", async () => {
    fake.varys.threads.send.mockReturnValueOnce(
      errAsync({ code: "THREAD_NOT_FOUND", message: "There's no such thread." }) as never,
    );
    const { events, sending } = send();
    await sending;
    expect(events).toEqual([
      { requestId: "req-1", type: "error", message: "agent_error: There's no such thread." },
    ]);
  });

  it("asks you what varys asks, and answers it in varys's inbox", async () => {
    const { events, sending } = send();
    await fake.play("req-1", [
      { type: "started", since: null },
      { type: "approval", approval },
      { type: "question", question },
    ]);
    expect(events.find((e) => e.type === "approval")).toEqual({
      requestId: "req-1",
      type: "approval",
      approval: {
        id: "a1",
        kind: "tool",
        title: "Send an email to Ann",
        detail: "To: ann@example.com",
        reason: "It reaches outside.",
        choices: ["once", "session", "deny"],
      },
    });
    await varysProvider.respondApproval("req-1", "a1", "session");
    expect(fake.varys.inbox.decide).toHaveBeenCalledWith("a1", { approve: true, inThread: true });
    await varysProvider.answerQuestion!("req-1", "q1", { q1: ["Friday"] });
    expect(fake.varys.inbox.answer).toHaveBeenCalledWith("q1", "Friday");
    expect(events.filter((e) => e.type.endsWith("Resolved")).map((e) => e.type)).toEqual([
      "approvalResolved",
      "questionResolved",
    ]);
    await fake.play("req-1", [{ type: "done" }]);
    await sending;
  });

  it("waits for your answer when varys stops to ask, and goes on in the same turn", async () => {
    const { events, sending } = send();
    await fake.play("req-1", [
      { type: "started", since: null },
      { type: "text", delta: "Calling mail_send." },
      { type: "answer", answer: answer("3", "Calling mail_send.") },
      { type: "waiting" },
      { type: "approval", approval },
    ]);
    await varysProvider.respondApproval("req-1", "a1", "once");
    expect(fake.varys.inbox.decide).toHaveBeenCalledWith("a1", { approve: true });
    await fake.play("req-1", [
      { type: "approvalResolved", id: "a1" },
      { type: "resumed", since: "2026-11-09T10:00:09.000Z" },
      { type: "text", delta: "Sent." },
      { type: "answer", answer: answer("5", "Sent.") },
      { type: "done" },
    ]);
    await sending;
    expect(replies(events)).toEqual(["Calling mail_send.", "Sent."]);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("stops the thread's run when you stop the turn", async () => {
    const { events, sending } = send();
    await fake.play("req-1", [{ type: "started", since: null }]);
    varysProvider.cancel("req-1");
    expect(fake.varys.threads.stop).toHaveBeenCalledWith("t1");
    await sending;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "cancelled" });
  });

  it("steers the run with your message", async () => {
    const { sending } = send();
    await fake.play("req-1", [{ type: "started", since: null }]);
    expect(await varysProvider.steer("req-1", "Make it shorter")).toBe(true);
    expect(fake.varys.threads.steer).toHaveBeenCalledWith("t1", { text: "Make it shorter" });
    await fake.play("req-1", [{ type: "done" }]);
    await sending;
  });

  it("lets go of a turn when the app quits, to pick it up again", async () => {
    const { events, sending } = send();
    await fake.play("req-1", [{ type: "started", since: null }]);
    varysProvider.shutdown();
    await sending;
    expect(events.at(-1)).toEqual({ requestId: "req-1", type: "error", message: "detached" });

    const resumed: ChatEvent[] = [];
    const resuming = varysProvider.resume!(
      { requestId: "req-1", sessionId: "t1" },
      settings,
      (event) => resumed.push(event),
    );
    await fake.play("req-1", [
      { type: "started", since: null },
      { type: "text", delta: "Back again." },
      { type: "done" },
    ]);
    await resuming;
    expect(resumed[0]).toEqual({ requestId: "req-1", type: "transcript", messages: [] });
    expect(replies(resumed)).toEqual(["Back again."]);
  });

  it("lists varys's threads, a routine's labeled as Scheduled", async () => {
    fake.varys.threads.list.mockReturnValueOnce(
      okAsync({
        threads: [
          { id: "t1", title: "Dinner with Ann", routine: null, updatedAt: "2026-11-09T10:00:00Z" },
          {
            id: "t9",
            title: "Invoices",
            routine: { id: "r1", title: "Invoices" },
            updatedAt: "2026-11-09T11:00:00Z",
          },
        ],
      }),
    );
    const sessions = await varysProvider.listSessions!(settings, 10);
    expect(sessions.map((s) => s.source)).toEqual(["varys", "Scheduled · Invoices"]);
  });

  it("says a message never got there when varys has no receipt for it", async () => {
    const events: ChatEvent[] = [];
    await varysProvider.resume!({ requestId: "lost", sessionId: "t1" }, settings, (e) =>
      events.push(e),
    );
    expect(events).toEqual([{ requestId: "lost", type: "error", message: "not_received" }]);
  });
});

describe("varys's models", () => {
  const deep = { ...settings, model: "rehearsal::rehearsal-deep", reasoningEffort: "high" };

  it("lists the models the owner's logins can use, with what each can do", async () => {
    const status = await varysProvider.checkStatus(settings);
    expect(status.models).toEqual([
      {
        slug: "rehearsal::rehearsal-quick",
        name: "rehearsal-quick",
        subProvider: "Rehearsal",
        isDefault: true,
        options: [],
      },
      {
        slug: "rehearsal::rehearsal-deep",
        name: "rehearsal-deep",
        subProvider: "Rehearsal",
        options: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            choices: [
              expect.objectContaining({ id: "", label: "Default", isDefault: true }),
              { id: "off", label: "Off" },
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
          {
            id: "serviceTier",
            label: "Speed",
            choices: [
              { id: "default", label: "Standard", isDefault: true },
              expect.objectContaining({ id: "fast", label: "Fast" }),
            ],
          },
        ],
      },
    ]);
  });

  it("says pairing again unlocks the picker for a grant that can't list them", async () => {
    fake.varys.models.list.mockReturnValueOnce(
      errAsync({ code: "FORBIDDEN", message: "This grant can't read settings." }),
    );
    const status = await varysProvider.checkStatus(settings);
    expect(status.models).toEqual([{ slug: "", name: "varys", isDefault: true }]);
    expect(status.message).toMatch(/Pair again to pick varys's models here/);
  });

  it("starts a new chat's thread with the model you picked", async () => {
    fake.varys.threads.start.mockImplementationOnce((input) => {
      fake.views.set(input.id, view(input.id, []));
      return okAsync({ requestId: input.requestId!, result: { threadId: input.id } });
    });
    const { sending } = send({ sessionId: undefined }, deep);
    await fake.play("req-1", [{ type: "done" }]);
    await sending;
    expect(fake.varys.threads.start).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          model: { provider: "rehearsal", model: "rehearsal-deep" },
          reasoning: "high",
          fast: false,
        },
      }),
    );
  });

  it("changes a chat's model only when you picked another", async () => {
    fake.views.set("t1", view("t1", []));
    const first = send({}, deep);
    await fake.play("req-1", [{ type: "done" }]);
    await first.sending;
    expect(fake.varys.threads.setModel).toHaveBeenCalledWith("t1", {
      model: { provider: "rehearsal", model: "rehearsal-deep" },
      reasoning: "high",
      fast: false,
    });

    const set = view("t1", []);
    set.model = {
      model: { provider: "rehearsal", model: "rehearsal-deep" },
      reasoning: "high",
      fast: false,
    };
    fake.views.set("t1", set);
    fake.varys.threads.setModel.mockClear();
    const again = send({ requestId: "req-2" }, deep);
    await fake.play("req-2", [{ type: "done" }]);
    await again.sending;
    expect(fake.varys.threads.setModel).not.toHaveBeenCalled();
  });

  it("leaves a chat to varys's default when nothing is picked", async () => {
    const { sending } = send();
    await fake.play("req-1", [{ type: "done" }]);
    await sending;
    expect(fake.varys.threads.setModel).not.toHaveBeenCalled();
  });

  it("shows varys's reason when the model can't answer", async () => {
    fake.views.set("t1", view("t1", []));
    fake.varys.threads.setModel.mockReturnValueOnce(
      errAsync({ code: "MODEL_NOT_READY", message: "Sign in to Rehearsal on your Mac first." }),
    );
    const { events, sending } = send({}, deep);
    await sending;
    expect(events).toEqual([
      {
        requestId: "req-1",
        type: "error",
        message: "agent_error: Sign in to Rehearsal on your Mac first.",
      },
    ]);
  });
});

describe("what varys does on its own", () => {
  function watch(sessions = [{ id: "t1", since: Date.parse("2026-11-09T10:00:00.000Z") }]) {
    const runs: AgentRun[] = [];
    const read: [string, string][] = [];
    varysProvider.watch!(
      settings,
      sessions,
      (run) => runs.push(run),
      (id, cursor) => read.push([id, cursor]),
    );
    return { runs, read };
  }

  it("follows a run the agent starts in a chat, and shows it as the chat follows it", async () => {
    const { runs } = watch();
    await fake.watching();
    fake.showThreads([{ id: "t1", status: "running", updatedAt: "2026-11-09T11:00:00.000Z" }]);
    await fake.playThread("t1", [
      { type: "started", since: null },
      { type: "text", delta: "Your routine found two invoices." },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      sessionId: "t1",
      delivery: { kind: "message", from: "varys" },
    });

    const events: ChatEvent[] = [];
    await varysProvider.resume!(
      { requestId: runs[0].requestId, sessionId: "t1" },
      settings,
      (event) => events.push(event),
    );
    await fake.playThread("t1", [
      { type: "answer", answer: answer("7", "Your routine found two invoices.") },
      { type: "done" },
    ]);
    expect(events[0]).toEqual({ requestId: runs[0].requestId, type: "transcript", messages: [] });
    expect(replies(events)).toEqual(["Your routine found two invoices."]);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("leaves a thread to the chat's turn that's about to be picked up again", async () => {
    const { runs } = watch([{ id: "t1", since: Number.MAX_SAFE_INTEGER }]);
    await fake.watching();
    fake.showThreads([{ id: "t1", status: "waiting", updatedAt: "2026-11-09T11:00:00.000Z" }]);
    expect(fake.followed("t1")).toBe(false);
    expect(runs).toEqual([]);
  });

  it("picks up a run of its own that waits for you after the app quit, to answer it", async () => {
    const waiting = view("t1", [said("1", "Forget fact 1"), answer("2", "Calling forget.")]);
    waiting.conversation.waiting = true;
    fake.views.set("t1", waiting);
    const events: ChatEvent[] = [];
    const resuming = varysProvider.resume!(
      { requestId: "agent:t1:old", sessionId: "t1" },
      settings,
      (event) => events.push(event),
    );
    await fake.playThread("t1", [
      { type: "started", since: null },
      { type: "waiting" },
      { type: "approval", approval },
    ]);
    await varysProvider.respondApproval("agent:t1:old", "a1", "once");
    expect(fake.varys.inbox.decide).toHaveBeenCalledWith("a1", { approve: true });
    await fake.playThread("t1", [
      { type: "resumed", since: "2026-11-09T10:00:09.000Z" },
      { type: "answer", answer: answer("5", "Forgotten.") },
      { type: "done" },
    ]);
    await resuming;
    expect(replies(events)).toEqual(["Forgotten."]);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("leaves a run your message started to that message's turn", async () => {
    const { runs } = watch();
    await fake.watching();
    fake.showThreads([{ id: "t1", status: "running", updatedAt: "2026-11-09T11:00:00.000Z" }]);
    await fake.playThread("t1", [
      { type: "started", since: null },
      { type: "message", message: said("8", "From varys's own app") as never },
      { type: "done" },
    ]);
    expect(runs).toEqual([]);
  });

  it("catches up on what varys wrote into a chat while no run was followed", async () => {
    fake.views.set(
      "t1",
      view("t1", [
        said("1", "Draft a friendly yes", "2026-11-09T09:00:00.000Z"),
        answer("2", "Done."),
        {
          type: "note",
          id: "3",
          text: "Two new invoices came in.",
          at: "2026-11-09T12:00:00.000Z",
          from: { thread: "t9", title: "Invoices" },
        },
      ]),
    );
    const { runs, read } = watch();
    await fake.watching();
    fake.showThreads([{ id: "t1", status: "done", updatedAt: "2026-11-09T12:00:00.000Z" }]);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toMatchObject({ sessionId: "t1", requestId: "delivered:t1@2" });
    expect(read).toEqual([["t1", "3"]]);

    const events: ChatEvent[] = [];
    await varysProvider.resume!({ requestId: "delivered:t1@2", sessionId: "t1" }, settings, (e) =>
      events.push(e),
    );
    expect(events).toEqual([
      {
        requestId: "delivered:t1@2",
        type: "transcript",
        messages: [{ role: "assistant", text: "Two new invoices came in." }],
      },
      { requestId: "delivered:t1@2", type: "done", responseId: null },
    ]);
  });

  it("makes a chat of a routine's run in a thread of its own", async () => {
    const { runs } = watch([]);
    await fake.watching();
    const at = new Date().toISOString();
    fake.showRoutines([
      {
        id: "r1",
        title: "Invoices",
        builtIn: false,
        instructions: "File new invoices",
        trigger: {
          type: "schedule",
          schedule: { type: "cron", cron: "0 8 * * *", zone: "Europe/Berlin" },
        },
        delivery: "each_run",
        model: {},
        mode: "standard",
        budget: { steps: 50, costUsd: 1 },
        connections: [],
        paused: false,
        lastRun: {
          id: "run-1",
          routineId: "r1",
          trigger: "schedule",
          dueAt: at,
          threadId: "t9",
          state: "ended",
          outcome: "succeeded",
          startedAt: at,
          endedAt: at,
        },
        createdAt: at,
        updatedAt: at,
      },
    ]);
    expect(runs).toEqual([
      expect.objectContaining({
        sessionId: "t9",
        requestId: "delivered:t9",
        chat: { title: expect.stringMatching(/^Invoices · /) },
        delivery: {
          kind: "automation",
          jobId: "r1",
          name: "Invoices",
          schedule: "0 8 * * * (Europe/Berlin)",
        },
      }),
    ]);
  });

  it("says which routine started a run in a chat", async () => {
    const { runs } = watch();
    await fake.watching();
    fake.showThreads([{ id: "t1", status: "running", updatedAt: "2026-11-09T11:00:00.000Z" }]);
    await fake.playThread("t1", [
      { type: "started", since: null, routine: { id: "r1", title: "Invoices" } },
      { type: "text", delta: "Two new invoices." },
    ]);
    expect(runs[0]).toMatchObject({
      delivery: { kind: "automation", jobId: "r1", name: "Invoices" },
    });
  });

  it("makes a chat of the first report of a routine that reports into a thread of its own", async () => {
    const { runs } = watch([]);
    await fake.watching();
    const at = new Date().toISOString();
    fake.showRoutines([
      {
        id: "r3",
        title: "Invoice watch",
        builtIn: false,
        instructions: "Report new invoices",
        trigger: { type: "new_mail", accounts: [] },
        delivery: "into_thread",
        model: {},
        mode: "standard",
        budget: { steps: 50, costUsd: 1 },
        connections: [],
        paused: false,
        lastRun: {
          id: "run-3",
          routineId: "r3",
          trigger: "new_mail",
          dueAt: at,
          threadId: "t7",
          state: "ended",
          outcome: "succeeded",
          startedAt: at,
          endedAt: at,
        },
        createdAt: at,
        updatedAt: at,
      },
    ] as RoutineList["routines"]);
    expect(runs).toMatchObject([{ sessionId: "t7", requestId: "delivered:t7" }]);
  });

  it("looks at once when Otter's relay says varys delivered something", async () => {
    fake.views.set("t5", view("t5", [answer("1", "Your morning brief.")]));
    const { runs } = watch([]);
    await fake.watching();
    varysProvider.delivered!(settings, "t5");
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toMatchObject({ sessionId: "t5", chat: { title: "Dinner with Ann" } });
  });

  it("names a routine's thread the relay points at after its routine", async () => {
    fake.views.set(
      "t6",
      view("t6", [answer("1", "Your morning brief.")], { id: "r2", title: "Morning brief" }),
    );
    const { runs } = watch([]);
    await fake.watching();
    varysProvider.delivered!(settings, "t6");
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]).toMatchObject({
      chat: { title: expect.stringMatching(/^Morning brief · /) },
      delivery: { kind: "automation", jobId: "r2", name: "Morning brief" },
    });
  });
});
