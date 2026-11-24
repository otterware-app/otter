import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./chat-store.ts", () => ({ clampTitle: (t: string) => t }));
vi.mock("../mail/hooks.ts", () => ({}));

const { buildHandoffText, mailLinkContext, mailOfLink } = await import("./chat-context.ts");

describe("the mail a message points to", () => {
  const context = {
    conversations: [
      { account: "a@x.com", threadId: "t1", subject: "Invoice", from: "Bo", messageIds: ["m1"] },
    ],
  };
  const lastLine = (reader?: string) =>
    buildHandoffText("Pay it?", context, reader).split("\n").at(-1);

  it("names what the agent reads mail with, or Otter's tools", () => {
    expect(lastLine("gog")).toBe("Fetch full content with gog if needed.");
    expect(lastLine("your mail connection")).toBe(
      "Fetch full content with your mail connection if needed.",
    );
    expect(lastLine()).toBe("Read them with the otter tools (get_thread) if needed.");
  });
});

describe("the link Otter Mail opens", () => {
  const link = (...mail: object[]) =>
    `dev.otterware.agents://new?${mail.map((m) => `mail=${encodeURIComponent(JSON.stringify(m))}`).join("&")}`;
  const draft = {
    kind: "draft",
    account: "me@example.com",
    threadID: "t 1",
    subject: "Re: Q3 & plans?",
    from: "me@example.com",
    messageIDs: ["m1", "m2"],
  };
  const quoted = {
    kind: "mail",
    account: "me@example.com",
    threadID: "t2",
    subject: "Dinner",
    from: "maya@example.com",
    messageIDs: ["m3"],
    quote: "See you at 7!\n“Bring bread” & wine",
  };

  it("carries the pointers to the mail, and nothing from another link", () => {
    expect(mailOfLink(link(draft, quoted))).toEqual([
      {
        account: "me@example.com",
        threadId: "t 1",
        subject: "Re: Q3 & plans?",
        from: "me@example.com",
        messageIds: ["m1", "m2"],
        kind: "draft",
      },
      {
        account: "me@example.com",
        threadId: "t2",
        subject: "Dinner",
        from: "maya@example.com",
        messageIds: ["m3"],
        quote: "See you at 7!\n“Bring bread” & wine",
        kind: "mail",
      },
    ]);
    expect(mailOfLink("dev.otterware.agents://new?mail=%7B%7D")).toEqual([]);
    expect(mailOfLink(link(draft).replace("://new", "://chat"))).toEqual([]);
    expect(mailOfLink("not a link")).toEqual([]);
  });

  it("is attached to the new chat as a quote, a draft or mail", () => {
    expect(mailLinkContext(link(quoted))?.kind).toBe("quote");
    expect(mailLinkContext(link(draft))).toMatchObject({
      kind: "draft",
      name: "Re: Q3 & plans?",
      meta: { count: 1, subjects: ["Re: Q3 & plans?"], kind: "draft" },
    });
    expect(mailLinkContext(link(draft, { ...quoted, quote: undefined }))?.kind).toBe("mixed");
    expect(mailLinkContext("dev.otterware.agents://new")).toBeNull();
  });

  it("tells the agent where the mail is, a draft as one", () => {
    const [mail, quote] = mailOfLink(link({ ...draft, threadID: "", messageIDs: ["m1"] }, quoted));
    const text = buildHandoffText("Why 7?", { conversations: [mail, quote] }, "gog");
    expect(text).toContain(
      '• Draft [me@example.com] "Re: Q3 & plans?" — from me@example.com (message m1)',
    );
    expect(text).toContain(
      '• Quoted from "Dinner" [me@example.com] (threadId t2):\n  “See you at 7!',
    );
  });
});
