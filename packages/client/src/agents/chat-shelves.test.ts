import { describe, expect, it } from "vite-plus/test";
import { chatSettledAt, chatShelf } from "./chat-shelves.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

type Shelved = Parameters<typeof chatShelf>[0];

/** You wrote in it `wrote` days ago and its last reply came `replied` days ago; renamed just now. */
const chat = (wrote: number, replied: number): Shelved => ({
  updatedAt: now,
  returnedAt: now - wrote * DAY,
  snoozedUntil: null,
  settledAt: null,
  pinnedAt: null,
  loaded: false,
  turns: [],
  lastMessageAt: now - replied * DAY,
});

const shelf = (c: Shelved, autoSettleDays: number | null, working = false) =>
  chatShelf(c, { working, needsYou: false, now, autoSettleDays });

describe("auto-settle", () => {
  it("settles a chat quiet for longer than the setting, whatever renamed it since", () => {
    expect(shelf(chat(9, 8), 7)).toBe("settled");
    expect(shelf(chat(9, 6), 7)).toBe("active");
    expect(shelf(chat(3, 2), 1)).toBe("settled");
  });

  it("never settles one when it's off, while it works, or when it's pinned", () => {
    expect(shelf(chat(60, 60), null)).toBe("active");
    expect(shelf(chat(60, 60), 7, true)).toBe("active");
    expect(shelf({ ...chat(60, 60), pinnedAt: now - 60 * DAY }, 7)).toBe("pinned");
  });

  it("keeps one you brought back active, and dates one that settled when it went quiet", () => {
    expect(shelf({ ...chat(60, 60), returnedAt: now - DAY }, 7)).toBe("active");
    expect(chatSettledAt(chat(9, 8), now)).toBe(now - 8 * DAY);
  });
});
