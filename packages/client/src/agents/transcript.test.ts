import { describe, expect, it } from "vite-plus/test";
import type { ChatTurn, ChatTurnItem } from "@otter/contracts/chats";
import { layoutReplies } from "./chat-runs.ts";
import {
  callTurns,
  contextLabel,
  deliveryLabel,
  openingCompactions,
  transcriptRows,
  type MessageRow,
  type ReplyRow,
} from "./transcript.ts";

const text = (t: string): ChatTurnItem => ({ kind: "text", text: t });
const step = (output?: string): ChatTurnItem => ({
  kind: "step",
  step: { kind: "command", title: "ls" },
  ...(output !== undefined && { output }),
});
const compaction = (output?: string): ChatTurnItem => ({
  kind: "step",
  step: { kind: "tool", title: "Compact", compaction: true },
  ...(output !== undefined && { output }),
});

const ask = (id: string, over: Partial<ChatTurn> = {}): ChatTurn => ({
  id,
  role: "user",
  text: id,
  startedAt: 0,
  ...over,
});
const reply = (id: string, items: ChatTurnItem[], over: Partial<ChatTurn> = {}): ChatTurn => ({
  id,
  role: "assistant",
  text: "",
  items,
  startedAt: 0,
  ...over,
});

function rows(
  turns: ChatTurn[],
  {
    streaming = false,
    detached = false,
    retryable = false,
    expanded = new Set<string>(),
  }: Partial<{
    streaming: boolean;
    detached: boolean;
    retryable: boolean;
    expanded: Set<string>;
  }> = {},
) {
  const layouts = layoutReplies(turns, { streaming, asking: false });
  return transcriptRows(turns, layouts, { streaming, detached, retryable, expanded });
}

describe("openingCompactions", () => {
  it("counts the compactions before anything else", () => {
    expect(openingCompactions([compaction(""), compaction(""), text("hi")])).toBe(2);
    expect(openingCompactions([text("hi"), compaction("")])).toBe(0);
    expect(openingCompactions([compaction("")])).toBe(1);
  });
});

describe("a message and what ran before the agent read it", () => {
  it("waits, dashed, while the agent compacts before reading it", () => {
    const turns = [ask("u-1"), reply("a-1", [compaction()])];
    const [message, answer] = rows(turns, { streaming: true }) as [MessageRow, ReplyRow];
    expect(message).toMatchObject({ waiting: true, compaction: null, runStartedAt: 0 });
    // "Working" shows above the message instead, so the reply doesn't say it again.
    expect(answer.working).toBe(false);
    expect(answer.work).toEqual([]);
  });

  it("keeps the compaction's divider above it once done, out of the reply", () => {
    const turns = [ask("u-1"), reply("a-1", [compaction(""), text("Done.")], { finishedAt: 5 })];
    const [message, answer] = rows(turns) as [MessageRow, ReplyRow];
    expect(message.waiting).toBe(false);
    expect(message.compaction).toMatchObject({ step: { compaction: true } });
    expect(answer.answer).toBe("Done.");
    expect(answer.work).toEqual([]);
  });

  it("marks where a steer starts", () => {
    const turns = [
      ask("u-1"),
      reply("a-1", [step("ok"), text("Working on it")]),
      ask("u-2", { intent: "steer" }),
      reply("a-2", [text("Sure")]),
    ];
    const marks = rows(turns, { streaming: true }).flatMap((r) =>
      r.kind === "message" ? [r.steered] : [],
    );
    expect(marks).toEqual([null, "steer"]);
  });
});

describe("a reply", () => {
  it("shows all it does while it runs, and no answer apart", () => {
    const turns = [ask("u-1"), reply("a-1", [step("ok"), text("Found it")])];
    const answer = rows(turns, { streaming: true })[1] as ReplyRow;
    expect(answer).toMatchObject({ live: true, working: true, answer: "" });
    expect(answer.work).toHaveLength(2);
  });

  it("folds its work once done, keeping its answer and the compactions between", () => {
    const turns = [
      ask("u-1"),
      reply("a-1", [step("ok"), compaction(""), step("ok"), text("All done")], {
        finishedAt: 10_000,
      }),
    ];
    const folded = rows(turns)[1] as ReplyRow;
    expect(folded.answer).toBe("All done");
    expect(folded.work).toEqual([compaction("")]);
    const fold = folded.layout?.foldedUnder;
    expect(fold).toBeTruthy();
    const open = rows(turns, { expanded: new Set([fold!]) })[1] as ReplyRow;
    expect(open.work).toHaveLength(3);
  });

  it("offers a retry and says the agent was lost only on the latest, once it stopped", () => {
    const turns = [
      ask("u-1"),
      reply("a-1", [text("first")], { finishedAt: 1, error: "Boom" }),
      ask("u-2"),
      reply("a-2", [text("second")], { finishedAt: 2, error: "Boom" }),
    ];
    const replies = rows(turns, { retryable: true, detached: true }).filter(
      (r): r is ReplyRow => r.kind === "reply",
    );
    expect(replies.map((r) => [r.retry, r.detached])).toEqual([
      [false, false],
      [true, true],
    ]);
    const streaming = rows(turns, { streaming: true, retryable: true, detached: true });
    expect((streaming.at(-1) as ReplyRow).retry).toBe(false);
  });

  it("ignores what's said in a call when finding the latest", () => {
    const turns = [
      ask("u-1"),
      reply("a-1", [text("answer")], { finishedAt: 1, error: "Boom" }),
      reply("a-call", [text("spoken")], { spoken: true, finishedAt: 2 }),
    ];
    const replies = rows(turns, { retryable: true }).filter(
      (r): r is ReplyRow => r.kind === "reply",
    );
    expect(replies.map((r) => r.retry)).toEqual([true, false]);
  });

  it("shows its changes once done", () => {
    const change = {
      title: "Draft",
      action: "created",
      target: { kind: "draft", accountId: "a", id: "d" },
    } as const;
    const turns = [ask("u-1"), reply("a-1", [text("ok")], { changes: [change] })];
    expect((rows(turns, { streaming: true })[1] as ReplyRow).showsChanges).toBe(false);
    expect((rows(turns)[1] as ReplyRow).showsChanges).toBe(true);
  });
});

describe("a call", () => {
  const call = [
    ask("u-1", { spoken: true }),
    reply("a-ack", [text("Yep, heard you.")], { spoken: true, finishedAt: 1 }),
    reply("a-run", [step("ok"), text("The full written answer.")], { finishedAt: 2 }),
    reply("a-said", [text("In short, it's done.")], { spoken: true, finishedAt: 3 }),
  ];

  it("shows what the voice said as one reply, after the agent's written answer", () => {
    const shown = rows(callTurns(call));
    expect(shown.map((r) => r.turn.id)).toEqual(["u-1", "a-run", "a-said"]);
    expect(shown[2].turn.items).toEqual([text("Yep, heard you. In short, it's done.")]);
  });

  it("folds the written answer once the voice has said it", () => {
    const written = rows(callTurns(call))[1] as ReplyRow;
    expect(written).toMatchObject({ answer: "", work: [] });
    expect(written.layout).toMatchObject({ heard: true, fold: { label: "Written answer" } });
    const opened = rows(callTurns(call), { expanded: new Set(["a-run"]) })[1] as ReplyRow;
    expect(opened.work).toHaveLength(2);
  });

  it("keeps the written answer in view while the voice hasn't said it", () => {
    const written = rows(call.slice(0, 3))[2] as ReplyRow;
    expect(written.answer).toBe("The full written answer.");
  });
});

describe("labels", () => {
  it("says what delivered a turn", () => {
    expect(deliveryLabel(reply("a", []))).toBeNull();
    expect(
      deliveryLabel(
        reply("a", [], { startedAt: undefined, delivered: { kind: "automation", name: "Brief" } }),
      ),
    ).toBe("Scheduled · Brief");
    expect(
      deliveryLabel(reply("a", [], { startedAt: undefined, delivered: { kind: "message" } })),
    ).toBe("Sent to you");
    expect(
      deliveryLabel(
        reply("a", [], { startedAt: undefined, delivered: { kind: "message", from: "Ops" } }),
      ),
    ).toBe("Sent by Ops");
  });

  it("names the mail a message is about", () => {
    expect(contextLabel({ kind: "mail", count: 3, subjects: ["A"] })).toBe("3 conversations");
    expect(contextLabel({ kind: "mail", count: 1, subjects: ["Hello"] })).toBe("Hello");
    expect(contextLabel({ kind: "mail", count: 1, subjects: [] })).toBe("1 conversation");
  });
});
