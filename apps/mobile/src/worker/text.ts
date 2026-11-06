import type { WorkerHost } from "@otter-mail/mobile-worker";

/**
 * WHATWG Encoding's TextDecoder for core and postal-mime on the worker:
 * UTF-8 and UTF-16 here, every legacy charset mail still arrives in
 * (ISO-8859-x, windows-125x, KOI8, Shift_JIS, GBK, Big5, EUC-KR…) through
 * the OS's own tables (CoreFoundation, WorkerHost.decodeText).
 */

const UTF8 = new Set([
  "utf-8",
  "utf8",
  "unicode-1-1-utf-8",
  "unicode11utf8",
  "unicode20utf8",
  "x-unicode20utf8",
]);
const UTF16LE = new Set([
  "utf-16",
  "utf-16le",
  "ucs-2",
  "unicode",
  "csunicode",
  "iso-10646-ucs-2",
  "unicodefeff",
]);
const UTF16BE = new Set(["utf-16be", "unicodefffe"]);
/** Labels the Encoding Standard reads as windows-1252, which CoreFoundation reads as true Latin-1. */
const WINDOWS_1252 = new Set([
  "ansi_x3.4-1968",
  "ascii",
  "cp1252",
  "cp819",
  "csisolatin1",
  "ibm819",
  "iso-8859-1",
  "iso-ir-100",
  "iso8859-1",
  "iso88591",
  "iso_8859-1",
  "iso_8859-1:1987",
  "l1",
  "latin1",
  "us-ascii",
  "windows-1252",
  "x-cp1252",
]);
const ALIASES: Record<string, string> = {
  "x-sjis": "shift_jis",
  sjis: "shift_jis",
  ms_kanji: "shift_jis",
  "windows-31j": "shift_jis",
  gb2312: "gbk",
  "x-gbk": "gbk",
  gb_2312: "gbk",
  cp936: "gbk",
  "x-euc-jp": "euc-jp",
  "ks_c_5601-1987": "euc-kr",
  "iso-8859-8-i": "iso-8859-8",
  "x-mac-roman": "macintosh",
  "tis-620": "windows-874",
  "iso-8859-11": "windows-874",
};

export function canonicalEncoding(label: string): string {
  const name = label.trim().toLowerCase();
  if (UTF8.has(name)) return "utf-8";
  if (UTF16LE.has(name)) return "utf-16le";
  if (UTF16BE.has(name)) return "utf-16be";
  if (WINDOWS_1252.has(name)) return "windows-1252";
  return ALIASES[name] ?? name;
}

function bytesOf(input: ArrayBuffer | ArrayBufferView | undefined): Uint8Array {
  if (input === undefined) return new Uint8Array(0);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function continuation(bytes: Uint8Array, i: number): boolean {
  return i < bytes.length && (bytes[i]! & 0xc0) === 0x80;
}

export function decodeUtf8(bytes: Uint8Array, fatal = false): string {
  let out = "";
  const units: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i]!;
    let code = -1;
    let size = 1;
    if (a < 0x80) code = a;
    else if (a >= 0xc2 && a < 0xe0 && continuation(bytes, i + 1)) {
      code = ((a & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      size = 2;
    } else if (a >= 0xe0 && a < 0xf0 && continuation(bytes, i + 1) && continuation(bytes, i + 2)) {
      code = ((a & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      size = 3;
      if (code < 0x800 || (code >= 0xd800 && code < 0xe000)) code = -1;
    } else if (
      a >= 0xf0 &&
      a < 0xf5 &&
      continuation(bytes, i + 1) &&
      continuation(bytes, i + 2) &&
      continuation(bytes, i + 3)
    ) {
      code =
        ((a & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      size = 4;
      if (code < 0x10000 || code > 0x10ffff) code = -1;
    }
    if (code < 0) {
      if (fatal) throw new TypeError("The encoded data was not valid utf-8.");
      units.push(0xfffd);
      i += 1;
    } else {
      if (code > 0xffff) {
        code -= 0x10000;
        units.push(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else units.push(code);
      i += size;
    }
    if (units.length > 8192) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  return out + String.fromCharCode(...units);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units: number[] = [];
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
    if (units.length > 8192) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  return out + String.fromCharCode(...units);
}

/** UTF-8 bytes a decode with `stream` must hold back: a character cut off at the end. */
function incompleteTail(bytes: Uint8Array): number {
  for (let i = bytes.length - 1; i >= Math.max(0, bytes.length - 3); i--) {
    const b = bytes[i]!;
    if ((b & 0xc0) === 0x80) continue;
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return bytes.length - i < need ? bytes.length - i : 0;
  }
  return 0;
}

export function installTextDecoder(host: WorkerHost): void {
  class OtterTextDecoder {
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    private pending: Uint8Array | null = null;

    constructor(label = "utf-8", options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
      this.encoding = canonicalEncoding(String(label));
      this.fatal = options.fatal === true;
      this.ignoreBOM = options.ignoreBOM === true;
      if (
        this.encoding !== "utf-8" &&
        this.encoding !== "utf-16le" &&
        this.encoding !== "utf-16be" &&
        host.decodeText(new ArrayBuffer(0), this.encoding) === undefined
      ) {
        throw new RangeError(`The "${label}" encoding is not supported.`);
      }
    }

    decode(input?: ArrayBuffer | ArrayBufferView, options: { stream?: boolean } = {}): string {
      let bytes = bytesOf(input);
      if (this.pending) {
        const joined = new Uint8Array(this.pending.length + bytes.length);
        joined.set(this.pending);
        joined.set(bytes, this.pending.length);
        bytes = joined;
        this.pending = null;
      }
      if (options.stream && this.encoding === "utf-8") {
        const keep = incompleteTail(bytes);
        if (keep > 0) {
          this.pending = bytes.slice(bytes.length - keep);
          bytes = bytes.subarray(0, bytes.length - keep);
        }
      }
      if (this.encoding === "utf-8") {
        if (!this.ignoreBOM && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
          bytes = bytes.subarray(3);
        }
        return decodeUtf8(bytes, this.fatal);
      }
      if (this.encoding === "utf-16le" || this.encoding === "utf-16be") {
        return decodeUtf16(bytes, this.encoding === "utf-16le");
      }
      return host.decodeText(bytes.slice().buffer as ArrayBuffer, this.encoding) ?? "";
    }
  }

  (globalThis as { TextDecoder?: unknown }).TextDecoder = OtterTextDecoder;
}
