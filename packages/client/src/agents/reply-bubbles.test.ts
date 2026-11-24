import { describe, expect, it } from "vite-plus/test";

import { replyBubbles, writtenBubbles } from "./reply-bubbles.ts";

describe("replyBubbles", () => {
  it("parts a reply into a bubble a paragraph, a list and a block", () => {
    const reply = [
      "Lena approved the budget **up to €12k**.",
      "",
      "- the venue shortlist",
      "- a yes or no",
      "  on Thursday",
      "",
      "```ts",
      "const a = 1;",
      "",
      "```",
      "",
      "> quoted",
      "> twice",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Done.",
    ].join("\n");
    expect(replyBubbles(reply)).toEqual([
      "Lena approved the budget **up to €12k**.",
      "- the venue shortlist\n- a yes or no\n  on Thursday",
      "```ts\nconst a = 1;\n\n```",
      "> quoted\n> twice",
      "| a | b |\n| - | - |\n| 1 | 2 |",
      "Done.",
    ]);
  });

  it("keeps a heading with what follows it, and leaves rules out", () => {
    expect(replyBubbles("# Plan\n\nFirst.\n\n---\n\n## Next\n- one\n- two\n\n## End")).toEqual([
      "# Plan\n\nFirst.",
      "## Next\n\n- one\n- two",
      "## End",
    ]);
  });

  it("keeps nested and task items in their list", () => {
    expect(replyBubbles("- [x] done\n  - nested\n- [ ] todo")).toEqual([
      "- [x] done\n  - nested\n- [ ] todo",
    ]);
  });
});

describe("writtenBubbles", () => {
  it("shows the finished bubbles, not the one being written", () => {
    expect(writtenBubbles("One.\n\nTwo is being wri")).toEqual(["One."]);
    expect(writtenBubbles("One.")).toEqual([]);
  });

  it("doesn't end a list on a marker still being written", () => {
    expect(writtenBubbles("Intro.\n\n- one\n- ")).toEqual(["Intro."]);
    expect(writtenBubbles("Intro.\n\n- one\n- two\n\nAfter")).toEqual(["Intro.", "- one\n- two"]);
  });

  it("holds an open code block until it's done", () => {
    expect(writtenBubbles("Code:\n\n```\nlet a")).toEqual(["Code:"]);
  });
});
