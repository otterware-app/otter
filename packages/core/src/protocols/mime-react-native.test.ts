import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { utf8Decode, utf8Encode } from "../bytes.ts";
import { parseMessage } from "./mime.ts";

// React Native's Blob, which postal-mime used to join each part's bytes with
// (patches/postal-mime@4.0.0.patch).
class ReactNativeBlob extends Blob {
  constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
    if (parts.some((part) => part instanceof ArrayBuffer || ArrayBuffer.isView(part))) {
      throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported");
    }
    super(parts, options);
  }
}

const everyByte = Uint8Array.from({ length: 256 }, (_, i) => i);
const everyByteBase64 = btoa(String.fromCharCode(...everyByte))
  .match(/.{1,76}/g)!
  .join("\r\n");
const privetKoi8 = [240, 210, 201, 215, 197, 212, 44, 32, 205, 201, 210];

function bytes(...parts: (string | number[])[]): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === "string" ? utf8Encode(part) : Uint8Array.from(part),
  );
  const joined = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

const message = bytes(
  [
    "From: Ann <ann@example.com>",
    "To: Bob <bob@example.com>",
    "Subject: =?UTF-8?Q?Caf=C3=A9?=",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="mixed"',
    "",
    "--mixed",
    'Content-Type: multipart/alternative; boundary="alt"',
    "",
    "--alt",
    "Content-Type: text/plain; charset=koi8-r",
    "Content-Transfer-Encoding: 8bit",
    "",
    "",
  ].join("\r\n"),
  privetKoi8,
  [
    "",
    "--alt",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>Caf=C3=A9 au lait, a line long enough that the sender wrapped it with a s=",
    "oft break</p>",
    "--alt--",
    "--mixed",
    'Content-Type: application/octet-stream; name="bytes.bin"',
    'Content-Disposition: attachment; filename="bytes.bin"',
    "Content-Transfer-Encoding: base64",
    "",
    everyByteBase64,
    "--mixed",
    'Content-Type: text/csv; name="list.csv"',
    'Content-Disposition: attachment; filename="list.csv"',
    "",
    "name,count",
    "otters,3",
    "--mixed",
    'Content-Type: text/plain; charset=utf-8; name="notes.txt"',
    'Content-Disposition: attachment; filename="notes.txt"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "na=C3=AFve",
    "--mixed--",
    "",
  ].join("\r\n"),
);

describe("parseMessage on React Native's Blob", () => {
  beforeAll(() => {
    vi.stubGlobal("Blob", ReactNativeBlob);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("stands in for React Native's", () => {
    expect(() => new Blob([new Uint8Array(1)])).toThrow(/not supported/);
    expect(() => new Blob([new ArrayBuffer(1)])).toThrow(/not supported/);
    expect(new Blob(["text"]).size).toBe(4);
  });

  it("parses every kind of part without building a Blob from bytes", async () => {
    const parsed = await parseMessage(message);
    expect(parsed.text?.trim()).toBe("Привет, мир");
    expect(parsed.html?.trim()).toBe(
      "<p>Café au lait, a line long enough that the sender wrapped it with a soft break</p>",
    );
    expect(parsed.headers.find((h) => h.name === "subject")?.value).toBe("=?UTF-8?Q?Caf=C3=A9?=");
    expect(parsed.attachments.map((a) => a.filename)).toEqual([
      "bytes.bin",
      "list.csv",
      "notes.txt",
    ]);
    const [binary, csv, notes] = parsed.attachments;
    expect(binary!.bytes).toEqual(everyByte);
    expect(utf8Decode(csv!.bytes).trimEnd()).toBe("name,count\notters,3");
    expect(utf8Decode(notes!.bytes).trimEnd()).toBe("naïve");
  });

  it("parses a message given as text", async () => {
    const parsed = await parseMessage(
      ["Subject: Hi", "Content-Type: text/plain; charset=utf-8", "", "Hello"].join("\r\n"),
    );
    expect(parsed.text?.trim()).toBe("Hello");
  });
});
