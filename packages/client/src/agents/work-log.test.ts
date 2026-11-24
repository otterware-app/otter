import { describe, expect, it } from "vite-plus/test";
import type { ChatTurnItem } from "@otter/contracts/chats";
import {
  blocksOf,
  compactionLabel,
  indentJson,
  jsonTokens,
  prettyJson,
  stepIcon,
} from "./work-log.ts";

const step = (title: string, over: Record<string, unknown> = {}): ChatTurnItem => ({
  kind: "step",
  step: { kind: "tool", title, ...over },
  output: "",
});

describe("blocksOf", () => {
  it("groups an integration's steps in a row, and only in a row", () => {
    const blocks = blocksOf([
      step("a", { source: "Gmail" }),
      step("b", { source: "Gmail" }),
      step("c", { source: "Gmail" }),
      { kind: "text", text: "between" },
      step("d", { source: "Gmail" }),
      step("e"),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["group", "text", "step", "step"]);
    expect(blocks[0]).toMatchObject({ source: "Gmail", items: [{}, {}, {}] });
  });

  it("reads back-to-back compactions as one, the latest", () => {
    const blocks = blocksOf([
      step("first", { compaction: true }),
      step("second", { compaction: true }),
    ]);
    expect(blocks).toEqual([{ kind: "step", item: step("second", { compaction: true }) }]);
  });
});

describe("steps", () => {
  it("wear their kind's icon, or their integration's", () => {
    expect(stepIcon({ kind: "command", title: "ls" })).toBe("terminal");
    expect(stepIcon({ kind: "web", title: "x", source: "Slack" })).toBe("command");
  });

  it("say how a compaction went", () => {
    expect(compactionLabel(undefined, true)).toBe("Compacting context");
    expect(compactionLabel(undefined, false)).toBe("Context compacted");
    expect(compactionLabel("", false)).toBe("Context compacted");
    expect(compactionLabel("too big", false)).toBe("Context compaction failed");
  });
});

describe("JSON", () => {
  it("lays out JSON, and leaves other text be", () => {
    expect(prettyJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson("plain text")).toBeNull();
    expect(prettyJson(undefined)).toBeNull();
  });

  it("indents JSON cut short, strings untouched", () => {
    expect(prettyJson('{"a": "x, {y}", "b": [1')).toBe(indentJson('{"a": "x, {y}", "b": [1'));
    expect(indentJson('{"a":"x, {y}","b":[1')).toBe('{\n  "a": "x, {y}",\n  "b": [\n    1');
  });

  it("splits JSON into strings, values and the rest", () => {
    expect(jsonTokens('{"a": true, "n": -1.5}')).toEqual([
      { text: "{", kind: "plain" },
      { text: '"a"', kind: "string" },
      { text: ": ", kind: "plain" },
      { text: "true", kind: "value" },
      { text: ", ", kind: "plain" },
      { text: '"n"', kind: "string" },
      { text: ": ", kind: "plain" },
      { text: "-1.5", kind: "value" },
      { text: "}", kind: "plain" },
    ]);
  });
});
