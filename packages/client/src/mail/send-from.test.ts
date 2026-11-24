import { describe, expect, it } from "vite-plus/test";
import { chosenAddress, replyAddress } from "./send-from.ts";
import type { MailAccount } from "./types.ts";

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

  it("replies from the alias mailbox it's read in, whoever the mail was to", () => {
    const cloud: MailAccount = {
      id: "robin@cloud.example",
      email: "robin@cloud.example",
      name: "Robin",
      sendAs: ["me@riverbank.example", "mail@riverbank.example"],
    };
    const message = { fromEmail: "ana@example.com", to: "mail@riverbank.example" };
    expect(replyAddress(cloud, message, "ME@riverbank.example")).toBe("me@riverbank.example");
    // Not one of its addresses (any more): as anywhere else.
    expect(replyAddress(cloud, message, "old@riverbank.example")).toBe("mail@riverbank.example");
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
