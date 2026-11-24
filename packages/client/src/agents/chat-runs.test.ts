import { describe, expect, it } from "vite-plus/test";
import type { ChatTurn, ChatTurnItem } from "@otter/contracts/chats";
import { continuesSteer, layoutReplies } from "./chat-runs.ts";

const text = (t: string): ChatTurnItem => ({ kind: "text", text: t });
const step = (output?: string): ChatTurnItem => ({
  kind: "step",
  step: { kind: "command", title: "ls" },
  ...(output !== undefined && { output }),
});

const ask = (id: string, at: number, intent?: ChatTurn["intent"]): ChatTurn => ({
  id,
  role: "user",
  text: id,
  startedAt: at,
  ...(intent && { intent }),
});
const reply = (id: string, at: number, items: ChatTurnItem[], end?: number): ChatTurn => ({
  id,
  role: "assistant",
  text: "",
  items,
  startedAt: at,
  ...(end !== undefined && { finishedAt: end }),
});

const SEC = 1000;
const done = { streaming: false, asking: false };
const going = { streaming: true, asking: false };

describe("a run in flight", () => {
  const turns = [
    ask("u-1", 0),
    reply("a-1", 0, [text("Looking"), step("ok")]),
    ask("u-2", 30 * SEC, "steer"),
    reply("a-2", 30 * SEC, [text("You're right")]),
  ];

  it("says it's working once, at its top, and folds nothing", () => {
    const layout = layoutReplies(turns, going);
    expect(layout.get("a-1")).toMatchObject({ live: true, working: true, fold: null });
    expect(layout.get("a-2")).toMatchObject({ live: true, working: false, fold: null });
  });

  it("ends thinking while no step runs", () => {
    expect(layoutReplies(turns, going).get("a-2")?.thinking).toBe(true);
    expect(layoutReplies(turns, going).get("a-1")?.thinking).toBe(false);
  });

  it("doesn't think in a step, while compacting, or while it asks you", () => {
    const inStep = [...turns.slice(0, 3), reply("a-2", 30 * SEC, [step()])];
    expect(layoutReplies(inStep, going).get("a-2")?.thinking).toBe(false);
    const afterStep = [...turns.slice(0, 3), reply("a-2", 30 * SEC, [step("ok")])];
    expect(layoutReplies(afterStep, going).get("a-2")).toMatchObject({
      thinking: false,
      stepping: true,
    });
    const compacting = [
      ask("u-1", 0),
      reply("a-1", 0, [{ kind: "step", step: { kind: "tool", title: "", compaction: true } }]),
    ];
    expect(layoutReplies(compacting, going).get("a-1")?.thinking).toBe(false);
    expect(layoutReplies(turns, { streaming: true, asking: true }).get("a-2")?.thinking).toBe(
      false,
    );
  });

  it("doesn't think while a step from before a steer still runs", () => {
    const steered = [
      ask("u-1", 0),
      reply("a-1", 0, [text("Looking"), step()]),
      ask("u-2", 30 * SEC, "steer"),
      reply("a-2", 30 * SEC, []),
    ];
    expect(layoutReplies(steered, going).get("a-2")).toMatchObject({
      thinking: false,
      stepping: false,
    });
  });

  it("keeps its last step lit while one from before a steer still runs", () => {
    const steered = [
      ask("u-1", 0),
      reply("a-1", 0, [step()]),
      ask("u-2", 30 * SEC, "steer"),
      reply("a-2", 30 * SEC, [step("ok")]),
    ];
    expect(layoutReplies(steered, going).get("a-2")).toMatchObject({
      thinking: false,
      stepping: true,
    });
  });

  it("thinks before it has written anything, even after a steer", () => {
    const fresh = [ask("u-1", 0), reply("a-1", 0, [])];
    expect(layoutReplies(fresh, going).get("a-1")).toMatchObject({ working: true, thinking: true });
    const steered = [
      ...turns.slice(0, 2),
      ask("u-2", 30 * SEC, "steer"),
      reply("a-2", 30 * SEC, []),
    ];
    expect(layoutReplies(steered, going).get("a-2")?.thinking).toBe(true);
  });
});

describe("a finished run", () => {
  it("folds its work under how long it worked, and keeps its answer", () => {
    const turns = [ask("u-1", 0), reply("a-1", 0, [step("ok"), text("Done")], 75 * SEC)];
    expect(layoutReplies(turns, done).get("a-1")).toMatchObject({
      fold: { id: "a-1", label: "Worked for 1m 15s", at: 0 },
      foldedUnder: "a-1",
      answers: true,
    });
  });

  it("has nothing to fold when it only answered", () => {
    const turns = [ask("u-1", 0), reply("a-1", 0, [text("Hi")], 2 * SEC)];
    expect(layoutReplies(turns, done).get("a-1")).toMatchObject({ fold: null, answers: true });
  });

  it("says it worked when it doesn't know for how long", () => {
    const turns = [ask("u-1", 0), reply("a-1", 0, [step("ok"), text("Done")])];
    expect(layoutReplies(turns, done).get("a-1")?.fold?.label).toBe("Worked");
  });

  it("keeps its work in view when it failed or was stopped", () => {
    const turns = [
      ask("u-1", 0),
      { ...reply("a-1", 0, [step("ok"), text("Half")], 5 * SEC), error: "Stopped." },
    ];
    expect(layoutReplies(turns, done).get("a-1")).toMatchObject({
      fold: null,
      foldedUnder: null,
    });
  });
});

describe("a steered run, once done", () => {
  const turns = [
    ask("u-1", 0),
    reply("a-1", 0, [text("Looking"), step("ok")], 100 * SEC),
    ask("u-2", 40 * SEC, "steer"),
    reply("a-2", 40 * SEC, [step("ok"), text("Answer")], 100 * SEC),
  ];

  it("times the whole run at its top, steers included", () => {
    expect(layoutReplies(turns, done).get("a-1")?.fold).toEqual({
      id: "a-1",
      label: "Worked for 1m 40s",
      at: 0,
    });
  });

  it("folds what came after the steer under its own row, from the steer", () => {
    expect(layoutReplies(turns, done).get("a-2")).toMatchObject({
      fold: { id: "a-2", label: "Continued for 1m 0s", at: 40 * SEC },
      foldedUnder: "a-2",
      answers: true,
    });
    expect(layoutReplies(turns, done).get("a-1")?.answers).toBe(false);
  });

  it("times a segment in the middle up to the next steer", () => {
    const more = [
      ...turns.slice(0, 3),
      reply("a-2", 40 * SEC, [step("ok")], 100 * SEC),
      ask("u-3", 70 * SEC, "steer"),
      reply("a-3", 70 * SEC, [step("ok"), text("Answer")], 100 * SEC),
    ];
    const layout = layoutReplies(more, done);
    expect(layout.get("a-2")?.fold?.label).toBe("Continued for 30s");
    expect(layout.get("a-3")?.fold?.label).toBe("Continued for 30s");
  });

  it("has no row for a steer that only got an answer", () => {
    const answered = [...turns.slice(0, 3), reply("a-2", 40 * SEC, [text("Answer")], 100 * SEC)];
    const layout = layoutReplies(answered, done);
    expect(layout.get("a-1")?.fold?.label).toBe("Worked for 1m 40s");
    expect(layout.get("a-2")).toMatchObject({ fold: null, foldedUnder: null, answers: true });
  });

  it("keeps an answer a steer split in view, both sides of the steer", () => {
    const split = [
      ask("u-1", 0),
      reply("a-1", 0, [step("ok"), text("Here's where")], 100 * SEC),
      ask("u-2", 40 * SEC, "steer"),
      reply("a-2", 40 * SEC, [text("things stand.")], 100 * SEC),
    ];
    const layout = layoutReplies(split, done);
    expect(layout.get("a-1")).toMatchObject({
      fold: { label: "Worked for 1m 40s" },
      answers: true,
    });
    expect(layout.get("a-2")).toMatchObject({ fold: null, answers: true });
  });

  it("doesn't split on a steer sent before the run wrote anything", () => {
    const early = [
      ask("u-1", 0),
      reply("a-1", 0, [], 100 * SEC),
      ask("u-2", 1 * SEC, "steer"),
      reply("a-2", 1 * SEC, [step("ok"), text("Answer")], 100 * SEC),
    ];
    const layout = layoutReplies(early, done);
    expect(layout.get("a-1")?.fold?.label).toBe("Worked for 1m 40s");
    expect(layout.get("a-2")).toMatchObject({ fold: null, foldedUnder: "a-1" });
  });

  it("splits back-to-back steers once, after the last", () => {
    const twice = [
      ...turns.slice(0, 3),
      reply("a-2", 40 * SEC, [], 100 * SEC),
      ask("u-3", 50 * SEC, "steer"),
      reply("a-3", 50 * SEC, [step("ok"), text("Answer")], 100 * SEC),
    ];
    const layout = layoutReplies(twice, done);
    expect(layout.get("a-2")?.fold).toBeNull();
    expect(layout.get("a-3")?.fold).toEqual({
      id: "a-3",
      label: "Continued for 50s",
      at: 50 * SEC,
    });
    expect(continuesSteer(twice, 4)).toBe(true);
    expect(continuesSteer(twice, 2)).toBe(false);
  });

  it("starts a new run at the next message", () => {
    const next = [...turns, ask("u-3", 200 * SEC), reply("a-3", 200 * SEC, [step()])];
    const layout = layoutReplies(next, going);
    expect(layout.get("a-2")?.fold?.label).toBe("Continued for 1m 0s");
    expect(layout.get("a-3")).toMatchObject({ live: true, working: true });
  });
});
