import { describe, expect, it } from "vite-plus/test";
import { attachmentProblem, extensionOf, isImage } from "./chat-attachments.ts";

const MB = 1024 * 1024;

describe("attachments", () => {
  it("takes GIF, JPEG, PNG and WebP as images, by type or, without one, by name", () => {
    expect(isImage({ name: "a", type: "image/png", size: 1 })).toBe(true);
    expect(isImage({ name: "a.JPG", type: "", size: 1 })).toBe(true);
    expect(isImage({ name: "a.jpg", type: "text/plain", size: 1 })).toBe(false);
  });

  it("refuses other images, empty files, and files over the limit", () => {
    expect(attachmentProblem({ name: "a.bmp", type: "image/bmp", size: 1 })).toMatch(
      /not a supported image/,
    );
    expect(attachmentProblem({ name: "a.heic", type: "image/heic", size: 1 })).toBeNull();
    expect(attachmentProblem({ name: "a.txt", type: "text/plain", size: 0 })).toMatch(/empty/);
    expect(attachmentProblem({ name: "a.png", type: "image/png", size: 10 * MB + 1 })).toMatch(
      /10 MB/,
    );
    expect(attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 50 * MB })).toBeNull();
    expect(
      attachmentProblem({ name: "a.pdf", type: "application/pdf", size: 50 * MB + 1 }),
    ).toMatch(/50 MB/);
  });

  it("names a file's extension", () => {
    expect(extensionOf("report.pdf")).toBe("PDF");
    expect(extensionOf(".env")).toBe("File");
    expect(extensionOf("archive.")).toBe("File");
  });
});
