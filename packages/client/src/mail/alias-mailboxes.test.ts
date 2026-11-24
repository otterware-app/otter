import { IMAP_CAPABILITIES } from "@otter/contracts";
import { describe, expect, it } from "vite-plus/test";
import { aliasMailboxesOf, signatureFor, withAliasMailbox } from "./alias-mailboxes.ts";
import type { MailAccount } from "./types.ts";

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

describe("aliasMailboxesOf", () => {
  it("has the addresses it sends from, not those added as mailboxes of their own", () => {
    expect(
      aliasMailboxesOf(cloud, [cloud, side]).map(({ id, name, color }) => ({ id, name, color })),
    ).toEqual([
      { id: "me@riverbank.example", name: "Me", color: expect.stringMatching(/^#/) },
      { id: "mail@riverbank.example", name: "Club", color: "#00c7be" },
    ]);
  });

  it("is none for a mailbox whose addresses come from its server (Gmail)", () => {
    expect(aliasMailboxesOf({ ...cloud, capabilities: undefined }, [cloud])).toEqual([]);
  });
});

describe("signatureFor", () => {
  it("is the alias mailbox's own, else the account's", () => {
    expect(signatureFor(cloud, "me@riverbank.example")).toBe("Me at Riverbank");
    expect(signatureFor(cloud, "mail@riverbank.example")).toBe("Robin");
    expect(signatureFor(cloud, "robin@cloud.example")).toBe("Robin");
  });
});

describe("withAliasMailbox", () => {
  it("adds, changes and takes away one", () => {
    const account = { ...cloud, aliasMailboxes: [{ address: "me@riverbank.example" }] };
    expect(withAliasMailbox(account, "mail@riverbank.example", {})).toEqual([
      { address: "me@riverbank.example" },
      { address: "mail@riverbank.example" },
    ]);
    expect(withAliasMailbox(account, "ME@riverbank.example", { name: "Home" })).toEqual([
      { address: "me@riverbank.example", name: "Home" },
    ]);
    expect(withAliasMailbox(account, "me@riverbank.example", null)).toEqual([]);
  });
});
