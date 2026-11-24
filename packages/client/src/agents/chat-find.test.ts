import { describe, expect, it } from "vite-plus/test";
import { findMatches, findTurns } from "./chat-find.ts";

describe("find in chat", () => {
  it("finds every match in a text, ignoring case", () => {
    expect(findMatches("Lisbon, then lisbon again", "LISBON")).toEqual([
      { start: 0, end: 6 },
      { start: 13, end: 19 },
    ]);
    expect(findMatches("a.b", ".")).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches("anything", "")).toEqual([]);
  });

  it("finds the turns a query is in, their steps' titles too", () => {
    const turns = [
      { id: "u-1", text: "Book the Café" },
      {
        id: "a-1",
        text: "",
        items: [
          { kind: "step" as const, step: { title: "Searched flights" } },
          { kind: "text" as const, text: "Done." },
        ],
      },
    ];
    expect(findTurns(turns, "CAFÉ")).toEqual(["u-1"]);
    expect(findTurns(turns, " flights ")).toEqual(["a-1"]);
    expect(findTurns(turns, "ed f")).toEqual(["a-1"]);
    expect(findTurns(turns, " ")).toEqual([]);
  });
});
