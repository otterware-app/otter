import { describe, expect, it } from "vite-plus/test";
import { isChatFileLink, isChatImageLink } from "./chat-links.ts";

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
