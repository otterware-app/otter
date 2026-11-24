import { describe, expect, it } from "vite-plus/test";
import { fileLinkLine, isChatFileLink, isChatImageLink } from "./chat-links.ts";

describe("agent image and file links", () => {
  it("knows local and gateway references", () => {
    for (const href of [
      "file:///tmp/confirmation.png",
      "sandbox:/mnt/data/confirmation.png",
      "/home/agent/confirmation.png",
      "./output/confirmation.png",
      "otter-artifact:managed%3Aimage%3A123",
    ])
      expect(isChatFileLink(href)).toBe(true);
    expect(isChatFileLink("https://example.com/image.png")).toBe(false);
    expect(isChatImageLink("https://example.com/image.png?ticket=1")).toBe(true);
  });

  it("knows Hermes inline images", () => {
    expect(isChatImageLink("data:image/png;base64,aGVsbG8=")).toBe(true);
  });
});

describe("a file link", () => {
  it("is a path with an extension, here or where the agent runs, not a web page", () => {
    expect(isChatFileLink("notes/plan.md")).toBe(true);
    expect(isChatFileLink("~/Desktop/a.png")).toBe(true);
    expect(isChatFileLink("https://otterware.app/a.png")).toBe(false);
    expect(isChatFileLink("#heading")).toBe(false);
  });

  it("names the line it points at", () => {
    expect(fileLinkLine("notes/plan.md:12")).toBe(12);
    expect(fileLinkLine("docs/readme.md:3-9")).toBe(3);
    expect(fileLinkLine("notes/plan.md")).toBeNull();
  });
});
