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
