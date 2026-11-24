import { describe, expect, it } from "vite-plus/test";
import { mailLinkContext } from "./chat-context.ts";
import { attachMail, chatMail, detachMail } from "./chat-mail.ts";

const link = `dev.otterware.agents.dev://new?mail=${encodeURIComponent(
  JSON.stringify({
    account: "me@x.com",
    threadID: "t1",
    subject: "Kickoff",
    from: "lena@x.com",
    messageIDs: ["m1"],
  }),
)}`;

describe("the mail a chat's next message is about", () => {
  it("is held per chat until it's removed", () => {
    const mail = mailLinkContext(link)!;
    attachMail("c1", mail);
    expect(chatMail("c1")?.name).toBe("Kickoff");
    expect(chatMail("c2")).toBeNull();
    detachMail("c1");
    expect(chatMail("c1")).toBeNull();
  });
});
