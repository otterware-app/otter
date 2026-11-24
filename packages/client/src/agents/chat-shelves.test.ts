import { describe, expect, it } from "vite-plus/test";
import type { ChatTab } from "@otter/contracts/chats";
import {
  chatSettledAt,
  chatShelf,
  shelveChats,
  shortAgo,
  snoozePresets,
  tabsSummary,
  wakesIn,
} from "./chat-shelves.ts";

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

describe("the shelves", () => {
  const listed = (id: string, updatedAt: number, more: Partial<Shelved> = {}) => ({
    id,
    updatedAt,
    returnedAt: undefined,
    snoozedUntil: null,
    settledAt: null,
    pinnedAt: null,
    loaded: false,
    turns: [],
    ...more,
  });

  it("puts each chat where the desktop does, in the order it lists them", () => {
    const shelves = shelveChats(
      [
        listed("fresh", now - 1000),
        listed("idle", now - 8 * DAY),
        listed("pinned-idle", now - 30 * DAY, { pinnedAt: now - 20 * DAY }),
        listed("snoozed", now - 1000, { snoozedUntil: now + 1000 }),
        listed("woke", now - 5000, { snoozedUntil: now - 10, returnedAt: now - 5000 }),
        listed("settled-asking", now - 1000, { settledAt: now - 500 }),
        listed("idle-working", now - 9 * DAY),
      ],
      {
        working: new Set(["idle-working"]),
        needsYou: new Set(["settled-asking"]),
        now,
        autoSettleDays: 7,
      },
    );
    const ids = (shelf: keyof typeof shelves) => shelves[shelf].map((c) => c.id);
    expect(ids("pinned")).toEqual(["pinned-idle"]);
    // The chat whose snooze just ran out is on top; an idle one a turn runs in stays; one the agent asks in comes back.
    expect(ids("active")).toEqual(["woke", "fresh", "settled-asking", "idle-working"]);
    expect(ids("snoozed")).toEqual(["snoozed"]);
    expect(ids("settled")).toEqual(["idle"]);
  });
});

describe("snoozing", () => {
  it("offers what's left of the day, and next week only when it isn't tomorrow", () => {
    const friday = new Date(2026, 10, 13, 19, 30);
    expect(snoozePresets(friday).map((p) => p.id)).toEqual([
      "hour",
      "three-hours",
      "tomorrow",
      "next-week",
    ]);
    const sunday = new Date(2026, 10, 15, 9);
    expect(snoozePresets(sunday).map((p) => p.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
    ]);
    expect(snoozePresets(sunday)[3].until).toBe(new Date(2026, 10, 16, 9).getTime());
  });

  it("says when a chat wakes, rounding up", () => {
    expect(wakesIn(90 * 60_000, 0)).toBe("2h");
    expect(wakesIn(30_000, 0)).toBe("1m");
    expect(wakesIn(0, 0)).toBe("now");
    expect(wakesIn(25 * 3_600_000, 0)).toBe("2d");
  });
});

describe("short times and what a chat made", () => {
  it("says how long ago, rounding down", () => {
    expect(shortAgo(0, 59_000)).toBe("now");
    expect(shortAgo(0, 3 * 3_600_000)).toBe("3h");
    expect(shortAgo(0, 15 * DAY)).toBe("2w");
  });

  it("counts its tabs by kind", () => {
    const tab = (kind: "draft" | "thread", id: string) =>
      ({ id, title: "", addedAt: 0, ref: { kind, accountId: "a", id } }) as ChatTab;
    expect(tabsSummary([tab("draft", "1"), tab("thread", "2"), tab("thread", "3")])).toBe(
      "1 draft · 2 emails",
    );
    expect(tabsSummary([])).toBe("");
  });
});
