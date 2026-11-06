import { describe, expect, it } from "vite-plus/test";

import { keepCopy, localCopySummaries, type LocalCopy } from "./local-drafts";
import type { SwiftRecoveredDraft } from "./recovered-drafts";

const copy = (id: string, accountId = "me@x.com", updated = 1): LocalCopy => ({
  id,
  accountId,
  to: "ana@x.com",
  subject: id,
  body: "",
  updated,
});

const legacy = (id: string, from = "me@x.com", updated = 0): SwiftRecoveredDraft => ({
  updated,
  draft: { id, from, to: "", cc: "", bcc: "", files: [], subject: id, body: "" },
});

describe("localCopySummaries", () => {
  it("lists the mailbox's own copies and the Swift app's not imported, newest first", () => {
    const list = localCopySummaries(
      "me@x.com",
      "me@x.com",
      [copy("kept", "me@x.com", Date.UTC(2026, 10, 1)), copy("other", "work@y.com")],
      [legacy("ios", "ME@x.com", 800_000_000), legacy("imported"), legacy("theirs", "work@y.com")],
      new Set(["imported"]),
    );
    expect(list.map((c) => [c.id, c.legacy])).toEqual([
      ["kept", false],
      ["ios", true],
    ]);
  });

  it("lists one copy once", () => {
    const list = localCopySummaries(
      "me@x.com",
      "me@x.com",
      [copy("same")],
      [legacy("same")],
      new Set(),
    );
    expect(list).toHaveLength(1);
  });
});

describe("keepCopy", () => {
  it("replaces a copy kept again", () => {
    expect(keepCopy([copy("a"), copy("b")], { ...copy("a"), subject: "new" })).toEqual([
      { ...copy("a"), subject: "new" },
      copy("b"),
    ]);
  });
});
