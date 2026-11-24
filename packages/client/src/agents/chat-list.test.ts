import { describe, expect, it } from "vite-plus/test";
import type { ChatMessageMatch } from "@otter/contracts/chats";
import {
  chatRowStatus,
  chatSearchResults,
  chatStatus,
  chatsWaitingOnYou,
  elapsed,
  newDraftChats,
  rowRecedes,
} from "./chat-list.ts";
import type { ApprovalRequest, ChatQuestion } from "./api.ts";
import type { ChatsState, Conversation } from "./chat-store.ts";

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
