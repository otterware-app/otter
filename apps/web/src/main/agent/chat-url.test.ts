import { describe, expect, it } from "vite-plus/test";
import { chatUrlTransform } from "./chat-url";

describe("agent image and file links", () => {
  it("preserves local and gateway references for the chat preview", () => {
    for (const href of [
      "file:///tmp/confirmation.png",
      "sandbox:/mnt/data/confirmation.png",
      "/home/agent/confirmation.png",
      "./output/confirmation.png",
      "otter-artifact:managed%3Aimage%3A123",
    ])
      expect(chatUrlTransform(href)).toBe(href);
  });

  it("allows Hermes inline images without allowing arbitrary data or executable URLs", () => {
    const image = "data:image/png;base64,aGVsbG8=";
    expect(chatUrlTransform(image)).toBe(image);
    for (const href of [
      "javascript:alert(1)",
      "javascript:evil.png",
      "data:text/html;base64,aGVsbG8=",
      "data:image/svg+xml;base64,aGVsbG8=",
    ])
      expect(chatUrlTransform(href)).toBe("");
  });
});
