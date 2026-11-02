import { describe, expect, it } from "vite-plus/test";
import { senderOf } from "../outgoing.ts";
import type { MailAccount } from "../../types.ts";

const account: MailAccount = {
  id: "me@icloud.com",
  email: "me@icloud.com",
  name: "Sam Lee",
  provider: "imap",
  sendAs: ["hello@samlee.dev"],
};

describe("senderOf", () => {
  it("sends from the mailbox's own address by default", () => {
    expect(senderOf(account)).toEqual({
      email: "me@icloud.com",
      from: "Sam Lee <me@icloud.com>",
    });
  });

  it("sends from another of its addresses, spelled as the mailbox has it", () => {
    expect(senderOf(account, "Hello@SamLee.dev")).toEqual({
      email: "hello@samlee.dev",
      from: "Sam Lee <hello@samlee.dev>",
    });
  });

  it("refuses an address that isn't the mailbox's", () => {
    expect(() => senderOf(account, "someone@else.com")).toThrow(/can't send from/);
  });
});

describe("senderOf for drafts", () => {
  it("keeps an address the mailbox no longer has, so saving never fails", () => {
    expect(senderOf(account, "old@samlee.dev", { draft: true }).email).toBe("old@samlee.dev");
    expect(() => senderOf(account, "old@samlee.dev")).toThrow(/can't send from/);
  });

  it("still refuses what isn't one address", () => {
    expect(() => senderOf(account, "a@b.com, c@d.com", { draft: true })).toThrow();
  });
});
