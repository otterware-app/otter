import { describe, expect, it } from "vite-plus/test";
import { attachmentPreview, decodeText, parseDelimited } from "./file-preview.ts";

describe("file previews", () => {
  it("shows a file by its type, or by its name when the type says nothing", () => {
    expect(attachmentPreview("notes.md", "application/octet-stream")).toEqual({
      kind: "markdown",
      mimeType: "text/markdown",
    });
    expect(attachmentPreview("a.json", "application/json; charset=utf-8")?.kind).toBe("text");
    expect(attachmentPreview("a.png", "image/png")?.kind).toBe("image");
    expect(attachmentPreview("a.zip", "application/zip")).toBeNull();
  });

  it("refuses binary data, and cuts long text", () => {
    expect(() => decodeText(new Uint8Array([104, 0, 105]))).toThrow(/binary/);
    expect(decodeText(new TextEncoder().encode("hé"))).toEqual({ text: "hé", truncated: false });
  });

  it("reads CSV with quotes", () => {
    expect(parseDelimited('a,"b,c"\n"say ""hi""",d', ",")).toEqual({
      rows: [
        ["a", "b,c"],
        ['say "hi"', "d"],
      ],
      truncated: false,
    });
  });
});
