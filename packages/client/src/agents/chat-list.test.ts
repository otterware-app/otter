import { describe, expect, it } from "vite-plus/test";
import type { ChatMessageMatch } from "@otter/contracts/chats";
import {
  activityPreview,
  activityStatus,
  chatActivity,
  chatRowDetail,
  chatRowStatus,
  chatSearchResults,
  chatStatus,
  chatsWaitingOnYou,
  elapsed,
  finishedElsewhere,
  flattenMessage,
  getChatShelf,
  isDetached,
  lastMessage,
  newDraftChats,
  recentChats,
  rowRecedes,
  runClock,
  setChatShelf,
  unreadChats,
  waitingLabel,
} from "./chat-list.ts";
import type { ApprovalRequest, ChatQuestion } from "./api.ts";
import type { ChatsState, Conversation } from "./chat-store.ts";
import { setHost } from "../host.ts";

const chat = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  provider: "hermes-1",
  sessionId: null,
  sessionOwned: true,
  lastResponseId: null,
  device: null,
  createdAt: 0,
  updatedAt: 0,
  tabs: [],
  turns: [{ id: "u-1", role: "user", text: "hi" }],
  loaded: true,
  ...over,
});

const approval = { id: "ap", kind: "command", title: "Run", choices: [] } as ApprovalRequest;
const question = { id: "q", questions: [], expiresAt: 0 } as ChatQuestion;

type Status = Pick<ChatsState, "runs" | "approvals" | "questions" | "conversations" | "unseen">;

function state(over: Partial<Status> = {}): Status {
  return { runs: {}, approvals: [], questions: [], conversations: [], unseen: new Set(), ...over };
}

const run = (convoId: string, requestId = `r-${convoId}`) => ({
  [convoId]: { requestId, convoId, provider: "hermes-1" },
});

describe("what a chat is doing", () => {
  it("puts an approval before a question, and either before working", () => {
    const both = state({
      runs: run("c"),
      approvals: [{ requestId: "r-c", approval }],
      questions: [{ requestId: "r-c", question }],
    });
    expect(chatStatus(both, "c")).toBe("approval");
    expect(chatStatus({ ...both, approvals: [] }, "c")).toBe("input");
    expect(chatStatus({ ...both, approvals: [], questions: [] }, "c")).toBe("working");
  });

  it("only counts what the chat's own run asks", () => {
    const s = state({ runs: run("c"), approvals: [{ requestId: "r-other", approval }] });
    expect(chatStatus(s, "c")).toBe("working");
  });

  it("says a failed reply, then something unseen, once nothing runs", () => {
    const failed = chat("c", {
      turns: [
        { id: "u-1", role: "user", text: "hi" },
        { id: "a-1", role: "assistant", text: "", error: "Nope" },
      ],
    });
    expect(chatStatus(state({ conversations: [failed], unseen: new Set(["c"]) }), "c")).toBe(
      "failed",
    );
    expect(chatStatus(state({ conversations: [chat("c")], unseen: new Set(["c"]) }), "c")).toBe(
      "done",
    );
    expect(chatStatus(state({ conversations: [chat("c")] }), "c")).toBeNull();
  });

  it("doesn't call a reply you stopped failed", () => {
    const stopped = chat("c", {
      turns: [
        { id: "u-1", role: "user", text: "hi" },
        { id: "a-1", role: "assistant", text: "", error: "Stopped." },
      ],
    });
    expect(chatStatus(state({ conversations: [stopped] }), "c")).toBeNull();
  });

  it("says a run that compacts is working", () => {
    const compacting = chat("c", {
      turns: [
        {
          id: "a-r",
          role: "assistant",
          text: "",
          items: [{ kind: "step", step: { kind: "tool", title: "Compacting", compaction: true } }],
        },
      ],
    });
    expect(chatStatus(state({ runs: run("c"), conversations: [compacting] }), "c")).toBe("working");
  });

  it("says how long a run has gone, from its reply's start", () => {
    const c = chat("c", {
      turns: [
        { id: "u-r-c", role: "user", text: "hi" },
        { id: "a-r-c", role: "assistant", text: "", startedAt: 1_000 },
      ],
    });
    const s = state({ runs: run("c"), conversations: [c] });
    expect(chatRowStatus(s, c, false, 1_000 + 95_000)).toEqual({
      kind: "working",
      label: "Working 1m",
      title: "Working",
    });
    expect(chatRowStatus(s, chat("c"), false, 0)?.label).toBe("Working");
  });

  it("words what a run handed off to subagents waits on as T3 Code words it", () => {
    expect(waitingLabel([])).toBe("Waiting");
    expect(waitingLabel(["Research pricing"])).toBe("Waiting · Research pricing");
    expect(waitingLabel([null])).toBe("Waiting on a subagent");
    expect(waitingLabel(["Research pricing", null])).toBe("Waiting on 2 subagents");
  });

  it("says a run waits on its subagents on its row, in its header and in a phone's preview", () => {
    const runs = {
      c: { requestId: "r-c", convoId: "c", provider: "openclaw-1", waiting: ["Docs"] },
    };
    const s = state({ runs, conversations: [chat("c")] });
    const activity = chatActivity(s, chat("c"));
    expect(activity).toEqual({ kind: "waiting", label: "Waiting · Docs" });
    expect(chatStatus(s, "c")).toBe("working");
    expect(chatRowStatus(s, chat("c"), false, 0)).toEqual({
      kind: "working",
      label: "Waiting",
      title: "Waiting · Docs",
    });
    expect(activityStatus(activity!)).toBe("waiting · Docs");
    expect(activityPreview(activity!, 2)).toBe("waiting · Docs · 2 queued");
    // An approval it asks while waiting still comes first.
    expect(
      chatActivity({ ...s, approvals: [{ requestId: "r-c", approval }] }, chat("c"))?.kind,
    ).toBe("approval");
  });

  it("doesn't say done on the chat you're in", () => {
    const s = state({ conversations: [chat("c")], unseen: new Set(["c"]) });
    expect(chatRowStatus(s, chat("c"), false, 0)?.label).toBe("Done");
    expect(chatRowStatus(s, chat("c"), true, 0)).toBeNull();
  });

  it("lets rows recede while working, or with nothing new", () => {
    const working = { kind: "working", label: "Working", title: "Working" } as const;
    const approvalStatus = { kind: "approval", label: "Approval", title: "x" } as const;
    expect(rowRecedes(working, true, false)).toBe(true);
    expect(rowRecedes(null, false, false)).toBe(true);
    expect(rowRecedes(approvalStatus, false, false)).toBe(true);
    expect(rowRecedes(null, true, false)).toBe(false);
    expect(rowRecedes(working, false, true)).toBe(false);
  });

  it("knows which chats wait on you", () => {
    const s = state({
      runs: { ...run("a"), ...run("b"), ...run("c") },
      approvals: [{ requestId: "r-a", approval }],
      questions: [{ requestId: "r-b", question }],
    });
    expect([...chatsWaitingOnYou(s)].sort()).toEqual(["a", "b"]);
  });
});

describe("elapsed", () => {
  it("rounds down to seconds, minutes, then hours", () => {
    expect(elapsed(0)).toBe("1s");
    expect(elapsed(59_999)).toBe("59s");
    expect(elapsed(60_000)).toBe("1m");
    expect(elapsed(3_600_000)).toBe("1h");
  });
});

describe("searching the chats", () => {
  const chats = [
    chat("a", { title: "Quarterly report", updatedAt: 1 }),
    chat("b", { title: "Lunch plans", updatedAt: 2 }),
    chat("c", { title: "Report on the trip", updatedAt: 3 }),
  ];
  const match = (id: string): ChatMessageMatch =>
    ({ id, turnId: "t", role: "user", snippet: "the report" }) as ChatMessageMatch;

  it("lists titles first, then chats a message matched, once each", () => {
    const results = chatSearchResults(chats, "report", 10, [match("c"), match("b")]);
    expect(
      results
        .slice(0, 2)
        .map((r) => r.chat.id)
        .sort(),
    ).toEqual(["a", "c"]);
    expect(results.slice(0, 2).every((r) => r.match === undefined && r.ranges.length > 0)).toBe(
      true,
    );
    expect(results.slice(2)).toMatchObject([{ chat: { id: "b" }, match: { id: "b" } }]);
  });

  it("finds nothing for nothing typed, and leaves out matches in chats not listed", () => {
    expect(chatSearchResults(chats, "  ", 10, [match("a")])).toEqual([]);
    expect(chatSearchResults(chats, "lunch", 10, [match("z")]).map((r) => r.chat.id)).toEqual([
      "b",
    ]);
  });
});

describe("new chats with a draft", () => {
  const blank = (id: string, createdAt: number) => chat(id, { turns: [], createdAt });
  const drafts = { a: "one", b: "two", c: "  " };
  const conversations = [blank("a", 1), blank("b", 2), blank("c", 3), chat("d")];

  it("lists those with words in their draft, newest first", () => {
    expect(
      newDraftChats(conversations, drafts, { openId: "", openedWithDraft: false, agent: null }).map(
        (c) => c.id,
      ),
    ).toEqual(["b", "a"]);
  });

  it("leaves out the one open until you leave it, unless it had a draft when opened", () => {
    const open = (openedWithDraft: boolean) =>
      newDraftChats(conversations, drafts, { openId: "b", openedWithDraft, agent: null }).map(
        (c) => c.id,
      );
    expect(open(false)).toEqual(["a"]);
    expect(open(true)).toEqual(["b", "a"]);
  });
});

describe("a phone's rows", () => {
  const reply = (id: string, text: string, more = {}) => ({
    id,
    role: "assistant" as const,
    text: "",
    items: [
      { kind: "step" as const, step: { kind: "read" as const, title: "Read" }, output: "ok" },
      { kind: "text" as const, text },
    ],
    ...more,
  });

  it("puts a message on one line, without Markdown's marks", () => {
    expect(flattenMessage("## Plan\n\n- **One**\n- Two\n\nSee `x`: \n- three")).toBe(
      "Plan · One · Two See x: three",
    );
  });

  it("reads a table as its cells' words", () => {
    expect(
      flattenMessage(
        "Two hires pay off\n\n| | One hire | Two hires |\n| --- | :---: | ---: |\n| Cost | €96k | €184k |\n\nSo, two.",
      ),
    ).toBe("Two hires pay off · One hire · Two hires · Cost · €96k · €184k So, two.");
  });

  it("shows the last words, with whether yours were answered", () => {
    const mine = chat("c", {
      turns: [
        { id: "u-1", role: "user", text: "Hi" },
        reply("a-1", "Hello **there**"),
        { id: "u-2", role: "user", text: "Plan it" },
      ],
    });
    expect(lastMessage(mine)).toMatchObject({ text: "Plan it", answered: false });
    const answered = chat("c", { turns: mine.turns.slice(0, 2) });
    expect(lastMessage(answered)).toMatchObject({ text: "Hello there", answered: false });
    expect(lastMessage(chat("c", { turns: [mine.turns[0], reply("a-1", "")] }))).toMatchObject({
      text: "Hi",
      answered: true,
    });
    const stopped = chat("c", {
      turns: [mine.turns[0], { id: "a-1", role: "assistant", text: "", error: "Stopped." }],
    });
    expect(lastMessage(stopped)).toMatchObject({ text: "", turn: { error: "Stopped." } });
    expect(lastMessage(chat("c", { loaded: false }))).toBeNull();
  });

  it("says what the chat made, else its agent, and where it runs", () => {
    expect(chatRowDetail(chat("c"), "Hermes")).toBe("Hermes");
    expect(
      chatRowDetail(
        chat("c", {
          device: { id: "mac", name: "Studio" },
          tabs: [
            { id: "d", title: "", addedAt: 0, ref: { kind: "draft", accountId: "a", id: "1" } },
          ],
        }),
        "Codex",
      ),
    ).toBe("1 draft · On Studio");
  });

  it("says what runs or waits, with what's queued behind it", () => {
    const working = chat("c", {
      turns: [
        { id: "u-r", role: "user", text: "hi" },
        { id: "a-r", role: "assistant", text: "", startedAt: 5 },
      ],
    });
    const s = state({ runs: run("c", "r") });
    expect(chatActivity(s, working)).toEqual({ kind: "working", since: 5 });
    expect(activityPreview(chatActivity(s, working)!, 1)).toBe("working… · 1 queued");
    expect(activityPreview(chatActivity(s, working)!)).toBe("working…");
    expect(chatActivity({ ...s, approvals: [{ requestId: "r", approval }] }, working)).toEqual({
      kind: "approval",
      title: "Run",
    });
    expect(activityStatus({ kind: "input", question: "" })).toBe("has a question");
    expect(activityPreview({ kind: "approval", title: "" })).toBe("Needs your approval");
    expect(chatActivity(state(), working)).toBeNull();
  });

  it("knows a turn it lost track of", () => {
    expect(isDetached(state(), chat("c", { openRequest: "r" }))).toBe(true);
    expect(isDetached(state({ runs: run("c", "r") }), chat("c", { openRequest: "r" }))).toBe(false);
  });

  it("lists the latest chats for the recents card, and counts those that want you", () => {
    const s = state({
      conversations: [
        chat("old", { updatedAt: 1 }),
        chat("new", { updatedAt: 3 }),
        chat("asking", { updatedAt: 2 }),
        chat("blank", { updatedAt: 4, turns: [] }),
      ],
      runs: run("asking", "r"),
      questions: [{ requestId: "r", question }],
      unseen: new Set(["old"]),
    });
    expect(recentChats(s).map((r) => [r.chat.id, r.status])).toEqual([
      ["new", null],
      ["asking", "working"],
      ["old", "unread"],
    ]);
    expect(unreadChats(s)).toEqual(new Set(["old", "asking"]));
  });
});

describe("the finished notice", () => {
  it("names a chat whose run ended while you were in another, and only one still listed", () => {
    const before = { ...run("a"), ...run("b"), ...run("gone") };
    const chats = [chat("a"), chat("b")];
    expect(finishedElsewhere(before, run("b"), null, chats)).toBe("a");
    expect(finishedElsewhere(before, run("b"), "a", chats)).toBeNull();
    expect(finishedElsewhere(before, before, null, chats)).toBeNull();
    expect(finishedElsewhere(run("gone"), {}, null, chats)).toBeNull();
  });
});

describe("the working control's clock", () => {
  it("counts from the answer, else your message, and says what it waits on", () => {
    const runs = run("c");
    expect(runClock(state(), chat("c"), 0)).toBeNull();
    expect(runClock(state({ runs }), chat("c"), 5_000)).toBe("Working");
    const asked = chat("c", { turns: [{ id: "u-1", role: "user", text: "hi", startedAt: 1_000 }] });
    expect(runClock(state({ runs }), asked, 5_000)).toBe("Working 4s");
    const answering = chat("c", {
      turns: [...asked.turns, { id: "a-r-c", role: "assistant", text: "", startedAt: 2_000 }],
    });
    expect(runClock(state({ runs }), answering, 64_000)).toBe("Working 1m 2s");
    const waiting = { c: { ...runs.c, waiting: ["Docs"] } };
    expect(runClock(state({ runs: waiting }), answering, 0)).toBe("Waiting · Docs");
  });
});

describe("the chosen shelf", () => {
  const stored = new Map<string, string>();
  setHost({
    storage: {
      get: (key) => stored.get(key) ?? null,
      set: (key, value) => void stored.set(key, value),
    },
    focused: () => true,
    onFocusChange: () => () => {},
    onLeave: () => () => {},
    notice: () => () => {},
    agentMark: () => undefined,
  });

  it("is remembered on the device, and Active until one is chosen", () => {
    expect(getChatShelf()).toBe("active");
    setChatShelf("snoozed");
    expect(getChatShelf()).toBe("snoozed");
    stored.set("gmail:chat-shelf", "pinned");
    expect(getChatShelf()).toBe("active");
  });
});
