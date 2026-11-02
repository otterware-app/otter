import { describe, expect, it } from "vite-plus/test";
import { chosenAddress, replyAddress } from "./send-from";
import type { MailAccount } from "./types";

const account: MailAccount = {
  id: "me@icloud.com",
  email: "me@icloud.com",
  name: "Sam",
  sendAs: ["hello@samlee.dev"],
};

describe("replyAddress", () => {
  it("replies from the address the mail was sent to, Cc included", () => {
    const message = { fromEmail: "ana@example.com", to: "bo@example.com", cc: "Hello@SamLee.dev" };
    expect(replyAddress(account, message)).toBe("hello@samlee.dev");
  });

  it("keeps the address the mailbox's own message went from", () => {
    const message = { fromEmail: "hello@samlee.dev", to: "ana@example.com" };
    expect(replyAddress(account, message)).toBe("hello@samlee.dev");
  });

  it("falls back to the mailbox's own address", () => {
    expect(replyAddress(account, { fromEmail: "ana@example.com", to: "list@example.com" })).toBe(
      "me@icloud.com",
    );
  });
});

describe("chosenAddress", () => {
  it("uses the fallback until one is picked", () => {
    expect(chosenAddress(account, undefined, "me@icloud.com")).toEqual({
      address: "me@icloud.com",
      unavailable: false,
    });
  });

  it("keeps a picked address the mailbox no longer has, marked unavailable", () => {
    expect(chosenAddress(account, "old@samlee.dev", "me@icloud.com")).toEqual({
      address: "old@samlee.dev",
      unavailable: true,
    });
  });
});
