import { describe, expect, it } from "vite-plus/test";
import { citationText, withCitations } from "./chat-cite.ts";

describe("quotes", () => {
  it("go to the agent as reference, each with its comment", () => {
    const input = withCitations("Shorten it", [
      { id: "1", text: "line one\nline two", comment: " too long " },
    ]);
    expect(input.startsWith("Shorten it\n\nThe user quotes your earlier replies")).toBe(true);
    expect(input.endsWith("> line one\n> line two\nComment: too long")).toBe(true);
    expect(withCitations("Just this", [])).toBe("Just this");
    expect(withCitations("", [{ id: "1", text: "a", source: "notes.md" }])).toMatch(
      /^The user quotes[^\n]*\n\nFrom notes\.md:\n> a$/,
    );
  });

  it("are trimmed, and cut short past 4,000 characters", () => {
    expect(citationText("  hi \n")).toBe("hi");
    expect(citationText("a".repeat(4001))).toBe(`${"a".repeat(4000)}…`);
  });
});
