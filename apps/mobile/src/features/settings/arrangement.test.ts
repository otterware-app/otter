import { describe, expect, it } from "vite-plus/test";

import {
  arrangeScopes,
  groupScopes,
  isShown,
  moveScope,
  parseArrangement,
  setScopeOn,
  type ArrangedMailbox,
} from "./arrangement";

const gmail: ArrangedMailbox = { email: "robin@gmail.com" };
const icloud: ArrangedMailbox = {
  email: "robin@icloud.com",
  provider: "imap",
  capabilities: { sendAs: "device" },
  sendAs: ["me@robin.example", "studio@robin.example", "gone@robin.example"],
  aliasMailboxes: [
    { address: "me@robin.example" },
    { address: "Studio@robin.example", name: "Studio", color: "#f97316" },
    { address: "stale@robin.example" },
  ],
};
const all = [gmail, icloud];
const keys = (arrangement = { order: [] as string[], off: [] as string[] }) =>
  arrangeScopes(all, arrangement).map((s) => s.key);

describe("the mailboxes' arrangement", () => {
  it("lists alias mailboxes after their parent, those still in its Send from only", () => {
    expect(keys()).toEqual([
      "robin@gmail.com",
      "robin@icloud.com",
      "me@robin.example",
      "studio@robin.example",
    ]);
    expect(arrangeScopes(all, { order: [], off: [] })[3]!.alias).toEqual({
      address: "Studio@robin.example",
      name: "Studio",
      color: "#f97316",
    });
  });

  it("puts an alias mailbox anywhere, and a new one beside the row before it", () => {
    const arrangement = { order: ["studio@robin.example", "robin@gmail.com"], off: [] };
    expect(keys(arrangement)).toEqual([
      "studio@robin.example",
      "me@robin.example",
      "robin@gmail.com",
      "robin@icloud.com",
    ]);
    expect(groupScopes(arrangeScopes(all, arrangement)).map((s) => s.key)).toEqual([
      "robin@gmail.com",
      "robin@icloud.com",
      "studio@robin.example",
      "me@robin.example",
    ]);
  });

  it("moves a row, writing every row's place", () => {
    const moved = moveScope(all, { order: [], off: ["robin@gmail.com"] }, 3, 0);
    expect(moved).toEqual({
      order: ["studio@robin.example", "robin@gmail.com", "robin@icloud.com", "me@robin.example"],
      off: ["robin@gmail.com"],
    });
  });

  it("turns rows off in the menu's order, and an alias mailbox off with its parent", () => {
    let arrangement = setScopeOn(all, { order: [], off: [] }, "studio@robin.example", false);
    arrangement = setScopeOn(all, arrangement, "robin@gmail.com", false);
    expect(arrangement.off).toEqual(["robin@gmail.com", "studio@robin.example"]);
    arrangement = setScopeOn(all, arrangement, "robin@gmail.com", true);
    expect(arrangement.off).toEqual(["studio@robin.example"]);

    const scopes = arrangeScopes(all, { order: [], off: ["robin@icloud.com"] });
    expect(scopes.filter((s) => isShown(s, { order: [], off: ["robin@icloud.com"] }))).toHaveLength(
      1,
    );
  });

  it("reads what another device wrote, or nothing", () => {
    expect(parseArrangement('{"order":["a",1],"off":"b"}')).toEqual({ order: ["a"], off: [] });
    expect(parseArrangement("not json")).toEqual({ order: [], off: [] });
  });
});
