import { describe, expect, it } from "vite-plus/test";

import {
  advanceDirection,
  advanceTarget,
  fileSize,
  htmlText,
  isOpen,
  mark,
  recipientsLine,
  splitAddresses,
  splitQuote,
} from "./reader";

describe("splitQuote", () => {
  it("keeps the reply and folds the quote after it", () => {
    const text = "Sounds good.\n\nOn Mon, 3 Nov 2026, Ana wrote:\n> Lunch on Friday?";
    expect(splitQuote(text)).toEqual({
      body: "Sounds good.",
      quote: "\n\nOn Mon, 3 Nov 2026, Ana wrote:\n> Lunch on Friday?",
    });
  });

  it("folds bare quoted lines", () => {
    expect(splitQuote("Yes\n> Are you coming?").body).toBe("Yes");
  });

  it("leaves a message with nothing quoted, or only a quote, whole", () => {
    expect(splitQuote("Just this.")).toEqual({ body: "Just this.", quote: null });
    expect(splitQuote("\n> only quoted").quote).toBeNull();
    expect(splitQuote("Hi\nOn the way home I wrote:\nnothing quoted").quote).toBeNull();
  });
});

describe("isOpen", () => {
  it("opens the last message, unread ones, and those tapped", () => {
    const expanded = new Set(["b"]);
    expect(isOpen({ id: "c", unread: false }, "c", expanded)).toBe(true);
    expect(isOpen({ id: "a", unread: true }, "c", expanded)).toBe(true);
    expect(isOpen({ id: "b", unread: false }, "c", expanded)).toBe(true);
    expect(isOpen({ id: "a", unread: false }, "c", expanded)).toBe(false);
  });
});

describe("advanceTarget", () => {
  const rows = ["a", "b", "c", "d"].map((threadId) => ({ threadId }));
  const all = new Set(["a", "b", "c", "d"]);

  it("goes to the next conversation, or the one before at the end", () => {
    expect(advanceTarget(rows, "b", all, "next")?.threadId).toBe("c");
    expect(advanceTarget(rows, "d", all, "next")?.threadId).toBe("c");
  });

  it("goes to the previous one, or the next at the top", () => {
    expect(advanceTarget(rows, "b", all, "previous")?.threadId).toBe("a");
    expect(advanceTarget(rows, "a", all, "previous")?.threadId).toBe("b");
  });

  it("skips what's left the list, and goes back to it on none", () => {
    expect(advanceTarget(rows, "b", new Set(["a", "d"]), "next")?.threadId).toBe("d");
    expect(advanceTarget(rows, "b", all, "none")).toBeNull();
    expect(advanceTarget([{ threadId: "b" }], "b", all, "next")).toBeNull();
  });

  it("reads the setting, next by default", () => {
    expect(advanceDirection(undefined)).toBe("next");
    expect(advanceDirection("previous")).toBe("previous");
    expect(advanceDirection("none")).toBe("none");
  });
});

describe("mark", () => {
  it("stars on Gmail and flags elsewhere", () => {
    expect(mark({ stars: true } as never).verb).toBe("Star");
    expect(mark({ stars: false } as never)).toMatchObject({ verb: "Flag", place: "Flagged" });
    expect(mark(undefined).symbol).toBe("star");
  });
});

describe("recipients", () => {
  it("splits lists, keeping commas in quoted names", () => {
    expect(splitAddresses('"Doe, Jane" <jane@x.com>, bo@y.com; c@z.com')).toEqual([
      '"Doe, Jane" <jane@x.com>',
      "bo@y.com",
      "c@z.com",
    ]);
  });

  it("names the mailbox's own addresses me", () => {
    const mine = new Set(["me@x.com"]);
    expect(recipientsLine("Ana <ana@x.com>, me@x.com", "bo@y.com", mine)).toBe(
      "to Ana, me, cc bo@y.com",
    );
  });
});

describe("htmlText", () => {
  it("reads an HTML body as text", () => {
    expect(htmlText("<style>p{}</style><p>Hello&nbsp;there</p><div>A &amp; B<br>C</div>")).toBe(
      "Hello there\nA & B\nC",
    );
  });
});

describe("fileSize", () => {
  it("sizes files as iOS does", () => {
    expect(fileSize(820)).toBe("820 bytes");
    expect(fileSize(14_200)).toBe("14 KB");
    expect(fileSize(2_150_000)).toBe("2.2 MB");
  });
});
