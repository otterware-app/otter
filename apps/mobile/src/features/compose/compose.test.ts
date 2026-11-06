import { describe, expect, it } from "vite-plus/test";

import { prefixed, replyRecipients, senders, signatureFor, validRecipient } from "./compose";

const message = {
  fromName: "Ana",
  fromEmail: "ana@x.com",
  to: "me@x.com, Bo <bo@y.com>",
  cc: "c@z.com, alias@x.com",
};
const mine = new Set(["me@x.com", "alias@x.com"]);

describe("replyRecipients", () => {
  it("replies to the sender", () => {
    expect(replyRecipients(message, mine, false)).toEqual({ to: ['"Ana" <ana@x.com>'], cc: [] });
  });

  it("copies everyone else on Reply all, never yourself", () => {
    expect(replyRecipients(message, mine, true)).toEqual({
      to: ['"Ana" <ana@x.com>'],
      cc: ["Bo <bo@y.com>", "c@z.com"],
    });
  });

  it("answers your own message to whom it went", () => {
    const sent = { fromName: "", fromEmail: "me@x.com", to: "ana@x.com", cc: "bo@y.com" };
    expect(replyRecipients(sent, mine, false)).toEqual({ to: ["ana@x.com"], cc: [] });
    expect(replyRecipients(sent, mine, true)).toEqual({ to: ["ana@x.com", "bo@y.com"], cc: [] });
  });
});

describe("validRecipient", () => {
  it("takes one address with both halves", () => {
    expect(validRecipient('"Ana" <ana@x.com>')).toBe(true);
    expect(validRecipient("ana@")).toBe(false);
    expect(validRecipient("ana x@y.com")).toBe(false);
    expect(validRecipient("a@b@c")).toBe(false);
  });
});

describe("senders", () => {
  const mailboxes = [
    { id: "me@x.com", email: "me@x.com", sendAs: ["Alias@x.com"] },
    { id: "work@y.com", email: "work@y.com" },
    { id: "gone@z.com", email: "gone@z.com", signedOut: true },
  ];

  it("offers every signed-in mailbox and alias for a new message", () => {
    expect(senders(mailboxes, "me@x.com", true).map((s) => s.address)).toEqual([
      "me@x.com",
      "alias@x.com",
      "work@y.com",
    ]);
  });

  it("keeps a reply in its mailbox", () => {
    expect(senders(mailboxes, "me@x.com", false).map((s) => s.address)).toEqual([
      "me@x.com",
      "alias@x.com",
    ]);
  });
});

describe("signatureFor", () => {
  it("prefers the alias mailbox's own signature", () => {
    const mailbox = {
      signature: "<b>Me</b>",
      aliasMailboxes: [{ address: "alias@x.com", signature: "<b>Alias</b>" }],
    };
    expect(signatureFor(mailbox, "ALIAS@x.com")).toBe("<b>Alias</b>");
    expect(signatureFor(mailbox, "me@x.com")).toBe("<b>Me</b>");
    expect(signatureFor({}, undefined)).toBeNull();
  });
});

describe("prefixed", () => {
  it("adds Re: and Fwd: once", () => {
    expect(prefixed("Re", "Lunch")).toBe("Re: Lunch");
    expect(prefixed("Re", "RE: Lunch")).toBe("RE: Lunch");
    expect(prefixed("Fwd", "Lunch")).toBe("Fwd: Lunch");
  });
});
