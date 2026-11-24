import { describe, expect, it } from "vite-plus/test";
import { chatFile, chatFilePath } from "../agent/files.ts";

describe("a file an agent links", () => {
  it("is read at its path, without its line", () => {
    expect(chatFilePath("file:///home/rowan/notes/plan%20a.md:12")).toBe(
      "/home/rowan/notes/plan a.md",
    );
    expect(chatFilePath("sandbox:/workspace/report.pdf")).toBe("/workspace/report.pdf");
    expect(chatFilePath("docs/readme.md:3-9")).toBe("docs/readme.md");
    expect(() => chatFilePath("file://other-mac/Users/x/a.md")).toThrow("another computer");
  });

  it("comes as base64 with its type, up to 50 MB", () => {
    expect(chatFile("a.json", new TextEncoder().encode("{}"), "application/json")).toEqual({
      name: "a.json",
      mimeType: "application/json",
      size: 2,
      data: "e30=",
    });
    expect(chatFile("a.bin", new Uint8Array(1)).mimeType).toBe("application/octet-stream");
  });
});
