import { IMAP_CAPABILITIES } from "@otter/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { MailAccount } from "@otter/client/mail/types";
import { arrangeMailboxes, moveMailbox } from "./mailboxes";

const cloud: MailAccount = {
  id: "robin@cloud.example",
  email: "robin@cloud.example",
  name: "Robin",
  provider: "imap",
  capabilities: IMAP_CAPABILITIES,
  signature: "Robin",
  sendAs: ["me@riverbank.example", "mail@riverbank.example", "side@other.example"],
  aliasMailboxes: [
    { address: "Me@Riverbank.example", signature: "Me at Riverbank" },
    { address: "mail@riverbank.example", name: "Club", color: "#00c7be" },
    { address: "gone@riverbank.example" },
    { address: "side@other.example" },
  ],
};
const side: MailAccount = { id: "side@other.example", email: "side@other.example", name: "Side" };

describe("arrangeMailboxes", () => {
  const ids = (order: string[]) =>
    arrangeMailboxes([cloud, side], { order, off: [] }).map((tab) => tab.id);

  it("puts each account's alias mailboxes after it until they're moved", () => {
    expect(ids([])).toEqual([
      "robin@cloud.example",
      "me@riverbank.example",
      "mail@riverbank.example",
      "side@other.example",
    ]);
  });

  it("puts every tab where it was dragged, one not dragged yet after the tab before it", () => {
    expect(ids(["me@riverbank.example", "side@other.example", "robin@cloud.example"])).toEqual([
      "me@riverbank.example",
      "mail@riverbank.example",
      "side@other.example",
      "robin@cloud.example",
    ]);
  });
});

describe("moveMailbox", () => {
  it("puts one before or after another, the rest where they were", () => {
    const off = ["robin@cloud.example"];
    const moved = moveMailbox(
      [cloud, side],
      { order: [], off },
      "mail@riverbank.example",
      "side@other.example",
      true,
    );
    expect(moved).toEqual({
      order: [
        "robin@cloud.example",
        "me@riverbank.example",
        "side@other.example",
        "mail@riverbank.example",
      ],
      off,
    });
  });
});
