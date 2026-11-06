import { describe, expect, it } from "vite-plus/test";

import { inline, parseMarkdown } from "./parse-markdown";

describe("inline", () => {
  it("styles bold, italics, code, strikethrough and links", () => {
    expect(inline("**Bold** and *it* with `x*y` ~~old~~ [site](https://a.b/c)")).toEqual([
      { text: "Bold", bold: true },
      { text: " and " },
      { text: "it", italic: true },
      { text: " with " },
      { text: "x*y", code: true },
      { text: " " },
      { text: "old", strike: true },
      { text: " " },
      { text: "site", href: "https://a.b/c" },
    ]);
  });

  it("nests styles and links bare addresses", () => {
    expect(inline("**see _this_** at https://otterware.app.")).toEqual([
      { text: "see ", bold: true },
      { text: "this", bold: true, italic: true },
      { text: " at " },
      { text: "https://otterware.app", href: "https://otterware.app" },
      { text: "." },
    ]);
  });

  it("leaves underscores inside words and escaped characters alone", () => {
    expect(inline("snake_case_name and \\*literal\\*")).toEqual([
      { text: "snake_case_name and *literal*" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, rules and code blocks", () => {
    expect(
      parseMarkdown("## Plan\nFirst line\nsecond line\n\n---\n```ts\nconst a = 1;\n\nlet b;\n```"),
    ).toEqual([
      { type: "heading", level: 2, spans: [{ text: "Plan" }] },
      { type: "paragraph", spans: [{ text: "First line\nsecond line" }] },
      { type: "rule" },
      { type: "code", lang: "ts", text: "const a = 1;\n\nlet b;" },
    ]);
  });

  it("nests lists, keeps an ordered list's start, and continues items", () => {
    const [list] = parseMarkdown("3. One\n   more\n4. Two\n   - a\n   - b\n");
    expect(list).toEqual({
      type: "list",
      ordered: true,
      start: 3,
      items: [
        [{ type: "paragraph", spans: [{ text: "One\nmore" }] }],
        [
          { type: "paragraph", spans: [{ text: "Two" }] },
          {
            type: "list",
            ordered: false,
            start: 1,
            items: [
              [{ type: "paragraph", spans: [{ text: "a" }] }],
              [{ type: "paragraph", spans: [{ text: "b" }] }],
            ],
          },
        ],
      ],
    });
  });

  it("ends a list at a paragraph after a blank line", () => {
    expect(parseMarkdown("- a\n- b\n\nAfter").map((b) => b.type)).toEqual(["list", "paragraph"]);
  });

  it("reads tables with alignment, filling short rows", () => {
    expect(parseMarkdown("| Name | Count |\n|:--|--:|\n| **a** | 1 |\n| b |")).toEqual([
      {
        type: "table",
        align: ["left", "right"],
        header: [[{ text: "Name" }], [{ text: "Count" }]],
        rows: [
          [[{ text: "a", bold: true }], [{ text: "1" }]],
          [[{ text: "b" }], []],
        ],
      },
    ]);
  });

  it("reads quotes as blocks", () => {
    expect(parseMarkdown("> Quoted\n> - item")).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", spans: [{ text: "Quoted" }] },
          {
            type: "list",
            ordered: false,
            start: 1,
            items: [[{ type: "paragraph", spans: [{ text: "item" }] }]],
          },
        ],
      },
    ]);
  });

  it("keeps an unclosed code block open to the end, as it streams", () => {
    expect(parseMarkdown("Look:\n```\nnpm i")).toEqual([
      { type: "paragraph", spans: [{ text: "Look:" }] },
      { type: "code", lang: "", text: "npm i" },
    ]);
  });
});
