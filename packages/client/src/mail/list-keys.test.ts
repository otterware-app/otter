import { describe, expect, it } from "vite-plus/test";

import { onePerConversation } from "./list-keys.ts";

describe("onePerConversation", () => {
  it("keeps a conversation that two pages both returned once, from the first page", () => {
    const first = { accountId: "a", threadId: "t1", id: "m3" };
    const pages = [
      [{ accountId: "a", threadId: "t0", id: "m0" }, first],
      [
        { accountId: "a", threadId: "t1", id: "m3" },
        { accountId: "a", threadId: "t2", id: "m4" },
      ],
    ];
    expect(onePerConversation(pages.flat()).map((row) => row.id)).toEqual(["m0", "m3", "m4"]);
    expect(onePerConversation(pages.flat())[1]).toBe(first);
  });

  it("tells the same thread id in two mailboxes apart", () => {
    const rows = [
      { accountId: "a", threadId: "t1", id: "m1" },
      { accountId: "b", threadId: "t1", id: "m1" },
    ];
    expect(onePerConversation(rows)).toHaveLength(2);
  });
});
