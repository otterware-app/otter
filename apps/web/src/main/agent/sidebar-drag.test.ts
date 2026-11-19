import { describe, expect, it } from "vite-plus/test";
import type { ChatShelf } from "./chat-shelves";
import {
  dropTarget,
  dropVerb,
  markerId,
  pinnedSlot,
  planDrop,
  sweepIds,
  type ListItem,
  type ListMarker,
} from "./sidebar-drag";

const marker = (name: ListMarker): ListItem => ({ kind: "marker", marker: name });
const chats = (shelf: ChatShelf, ...ids: string[]): ListItem[] =>
  ids.map((id) => ({ kind: "chat", id, shelf }));

// Two pinned, three active, one snoozed, one settled: the list as the sidebar lays it out.
const items: ListItem[] = [
  marker("pinned-header"),
  ...chats("pinned", "p1", "p2"),
  marker("pinned-divider"),
  marker("active-placeholder"),
  ...chats("active", "a1", "a2", "a3"),
  marker("snoozed-header"),
  ...chats("snoozed", "z1"),
  marker("settled-header"),
  marker("settled-placeholder"),
  ...chats("settled", "s1"),
];

describe("dropTarget", () => {
  it("pins a chat dropped among the pinned ones, where it was dropped", () => {
    expect(dropTarget(items, "a2", "p1")).toEqual({
      shelf: "pinned",
      pinnedOrder: ["a2", "p1", "p2"],
    });
  });

  it("reorders the pinned chats", () => {
    expect(dropTarget(items, "p2", "p1")).toEqual({ shelf: "pinned", pinnedOrder: ["p2", "p1"] });
  });

  it("settles a chat dropped on the settled shelf, even when it's closed", () => {
    expect(dropTarget(items, "a1", markerId("settled-placeholder"))?.shelf).toBe("settled");
  });

  it("settles a chat dropped on the Settled heading, with or without Snoozed above it", () => {
    expect(dropTarget(items, "a1", markerId("settled-header"))?.shelf).toBe("settled");
    expect(dropTarget(items, "p1", markerId("settled-header"))?.shelf).toBe("settled");
    const unsnoozed = items.filter((item) =>
      item.kind === "chat" ? item.shelf !== "snoozed" : item.marker !== "snoozed-header",
    );
    expect(dropTarget(unsnoozed, "a3", markerId("settled-header"))?.shelf).toBe("settled");
    expect(dropTarget(unsnoozed, "p2", markerId("settled-header"))?.shelf).toBe("settled");
  });

  it("brings a chat back among the active ones", () => {
    expect(dropTarget(items, "s1", "a2")?.shelf).toBe("active");
    expect(dropTarget(items, "z1", "a3")?.shelf).toBe("active");
  });

  it("has no drop on the snoozed shelf", () => {
    expect(dropTarget(items, "a1", "z1")).toBeNull();
  });
});

describe("dropVerb", () => {
  it("names what letting go does", () => {
    expect(dropVerb("active", "pinned")).toBe("pin");
    expect(dropVerb("pinned", "active")).toBe("unpin");
    expect(dropVerb("active", "settled")).toBe("settle");
    expect(dropVerb("settled", "active")).toBe("unsettle");
    expect(dropVerb("snoozed", "active")).toBe("wake");
    expect(dropVerb("pinned", "pinned")).toBeNull();
    expect(dropVerb("active", null)).toBeNull();
  });
});

describe("planDrop", () => {
  const pinnedAt = new Map([
    ["p1", 1_000],
    ["p2", 2_000],
  ]);
  const plan = (id: string, from: ChatShelf, overId: string) =>
    planDrop({
      id,
      from,
      target: dropTarget(items, id, overId)!,
      pinnedOrder: ["p1", "p2"],
      pinnedAt,
      now: 5_000,
    });

  it("does nothing among the active chats, which keep to when you came back to them", () => {
    expect(plan("a1", "active", "a3")).toEqual({ kind: "none" });
  });

  it("pins between the pinned chats it was dropped between", () => {
    expect(plan("a1", "active", "p2")).toEqual({
      kind: "pin",
      pinnedAt: new Map([["a1", 1_500]]),
    });
  });

  it("leaves the pinned chats be when one is dropped where it was", () => {
    expect(plan("p1", "pinned", "p1")).toEqual({ kind: "none" });
  });

  it("settles, and brings back", () => {
    expect(plan("p1", "pinned", "s1")).toEqual({ kind: "settle" });
    expect(plan("s1", "settled", "a1")).toEqual({ kind: "active" });
    expect(plan("p2", "pinned", "a1")).toEqual({ kind: "active" });
  });
});

describe("pinnedSlot", () => {
  const at = new Map([
    ["a", 100],
    ["b", 200],
    ["c", 201],
  ]);

  it("goes last at now, first before the first", () => {
    expect(pinnedSlot(["a", "b", "c", "x"], at, "x", 500)).toEqual(new Map([["x", 500]]));
    expect(pinnedSlot(["x", "a", "b", "c"], at, "x", 500)).toEqual(new Map([["x", 99]]));
  });

  it("takes the whole millisecond between its neighbours", () => {
    expect(pinnedSlot(["a", "x", "b", "c"], at, "x", 500)).toEqual(new Map([["x", 150]]));
  });

  it("numbers them all again when there's no millisecond between them", () => {
    expect(pinnedSlot(["a", "b", "x", "c"], at, "x", 500)).toEqual(
      new Map([
        ["a", 100],
        ["b", 101],
        ["x", 102],
        ["c", 103],
      ]),
    );
  });
});

describe("sweepIds", () => {
  it("takes the rows between the press and the pointer, on the same shelf", () => {
    const order = ["a1", "a2", "a3", "s1"];
    const active = (id: string) => id.startsWith("a");
    expect(sweepIds(order, "a1", "a3", active)).toEqual(["a1", "a2", "a3"]);
    expect(sweepIds(order, "a3", "a2", active)).toEqual(["a2", "a3"]);
    expect(sweepIds(order, "a2", "s1", active)).toEqual(["a2", "a3"]);
  });
});
