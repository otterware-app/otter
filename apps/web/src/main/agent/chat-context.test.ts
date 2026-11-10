import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./chat-store", () => ({ clampTitle: (t: string) => t }));
vi.mock("../mail/hooks", () => ({}));

const { buildHandoffText } = await import("./chat-context");

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
