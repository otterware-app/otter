/**
 * IMAP responses (RFC 9051, RFC 3501) from raw bytes. The reader finds where
 * each response ends as chunks arrive (a literal `{n}` holds n bytes of
 * anything, CRLFs included, and may be megabytes), then the tokenizer turns
 * it into atoms, strings, literals and lists.
 */

import { utf8Decode, utf8Encode } from "../../bytes.js";

export type ImapToken =
  | { type: "atom"; value: string }
  | { type: "string"; value: string }
  | { type: "literal"; bytes: Uint8Array }
  | { type: "nil" }
  | { type: "list"; items: ImapToken[] };

export interface ImapResponse {
  tag: string;
  /** Upper-cased: OK, NO, BAD, BYE, PREAUTH, CAPABILITY, LIST, FETCH, EXISTS, … ("" for "+"). */
  type: string;
  number?: number;
  /** A status response's code: `[UIDVALIDITY 3857529045]` → { name: "UIDVALIDITY", args }. */
  code?: { name: string; args: ImapToken[] };
  text: string;
  args: ImapToken[];
}

export class ImapParseError extends Error {
  constructor(message: string, line: Uint8Array, at = 0) {
    const from = Math.max(0, at - 80);
    super(`${message} at byte ${at}: ${utf8Decode(line.subarray(from, at + 80)).trimEnd()}`);
    this.name = "ImapParseError";
  }
}

const STATUS = new Set(["OK", "NO", "BAD", "BYE", "PREAUTH"]);

const CR = 13;
const LF = 10;
const SP = 32;
const QUOTE = 34;
const LPAREN = 40;
const RPAREN = 41;
const LBRACKET = 91;
const BACKSLASH = 92;
const RBRACKET = 93;
const LBRACE = 123;
const RBRACE = 125;
const TILDE = 126;
const PLUS = 43;

export const MAX_LINE = 1024 * 1024;
/** The largest literal: bigger than any message a mail server would take. */
export const MAX_LITERAL = 100 * 1024 * 1024;

export class ResponseReader {
  private buf = new Uint8Array(16 * 1024);
  private start = 0;
  private end = 0;
  private line = 0;
  private scan = 0;

  push(chunk: Uint8Array): void {
    if (this.start === this.end) this.start = this.end = this.line = this.scan = 0;
    if (this.end + chunk.length > this.buf.length) {
      // Drop what's been consumed, then grow (doubling, so large literals stay linear).
      this.buf.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.line -= this.start;
      this.scan -= this.start;
      this.start = 0;
      if (this.end + chunk.length > this.buf.length) {
        const grown = new Uint8Array(Math.max(this.buf.length * 2, this.end + chunk.length));
        grown.set(this.buf.subarray(0, this.end));
        this.buf = grown;
      }
    }
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }

  /** Bytes received but not yet part of a response (should be none before STARTTLS). */
  get pending(): number {
    return this.end - this.start;
  }

  next(): ImapResponse | null {
    for (;;) {
      const lf = this.buf.subarray(0, this.end).indexOf(LF, this.scan);
      if ((lf < 0 ? this.end : lf) - this.line > MAX_LINE) {
        throw new ImapParseError("Response line too long", this.buf.subarray(this.line, this.end));
      }
      if (lf < 0) {
        this.scan = this.end;
        return null;
      }
      const literal = literalSize(this.buf, this.line, lf);
      if (literal !== null && literal > MAX_LITERAL) {
        throw new ImapParseError(
          `Literal too large (${literal} bytes)`,
          this.buf.subarray(this.line, lf),
        );
      }
      if (literal === null) {
        const frame = this.buf.slice(this.start, lf + 1);
        this.start = this.line = this.scan = lf + 1;
        return parseResponse(frame);
      }
      if (lf + 1 + literal > this.end) {
        this.scan = lf;
        return null;
      }
      this.line = this.scan = lf + 1 + literal;
    }
  }
}

function literalSize(buf: Uint8Array, from: number, lf: number): number | null {
  let i = lf - 1;
  if (i >= from && buf[i] === CR) i--;
  if (i < from || buf[i] !== RBRACE) return null;
  i--;
  if (buf[i] === PLUS) i--;
  let size = 0;
  let scale = 1;
  let digits = 0;
  while (i >= from && buf[i]! >= 48 && buf[i]! <= 57) {
    size += (buf[i]! - 48) * scale;
    scale *= 10;
    digits++;
    i--;
  }
  return digits > 0 && i >= from && buf[i] === LBRACE ? size : null;
}

export function parseResponse(frame: Uint8Array): ImapResponse {
  let end = frame.length;
  if (frame[end - 1] === LF) end--;
  if (frame[end - 1] === CR) end--;
  const cursor = new Cursor(frame, end);

  if (frame[0] === PLUS) {
    cursor.pos = frame[1] === SP ? 2 : 1;
    return { tag: "+", type: "", text: cursor.rest(), args: [] };
  }

  const tag = cursor.atom(false);
  if (!tag) throw new ImapParseError("Expected a tag", frame);
  cursor.space();
  let first = cursor.atom(false);
  let number: number | undefined;
  if (tag === "*" && /^\d+$/.test(first)) {
    number = Number(first);
    cursor.space();
    first = cursor.atom(false);
  }
  const type = first.toUpperCase();
  if (!type) throw new ImapParseError("Expected a response type", frame);

  if (STATUS.has(type)) {
    cursor.space();
    const code = cursor.peek() === LBRACKET ? cursor.code() : undefined;
    cursor.space();
    return { tag, type, number, code, text: cursor.rest(), args: [] };
  }
  return { tag, type, number, text: "", args: cursor.tokens(false) };
}

class Cursor {
  pos = 0;

  constructor(
    readonly bytes: Uint8Array,
    readonly end: number,
  ) {}

  peek(): number {
    return this.pos < this.end ? this.bytes[this.pos]! : -1;
  }

  space(): void {
    while (this.peek() === SP) this.pos++;
  }

  rest(): string {
    const text = utf8Decode(this.bytes.subarray(this.pos, this.end));
    this.pos = this.end;
    return text;
  }

  code(): { name: string; args: ImapToken[] } {
    this.pos++;
    const name = this.atom(true).toUpperCase();
    const argsStart = this.pos;
    try {
      const args = this.tokens(true);
      if (this.peek() !== RBRACKET)
        throw new ImapParseError("Unclosed response code", this.bytes, this.pos);
      this.pos++;
      return { name, args };
    } catch {
      const close = this.bytes.subarray(0, this.end).indexOf(RBRACKET, argsStart);
      const stop = close < 0 ? this.end : close;
      const raw = utf8Decode(this.bytes.subarray(argsStart, stop)).trim();
      this.pos = close < 0 ? this.end : close + 1;
      return { name, args: raw ? [{ type: "atom", value: raw }] : [] };
    }
  }

  tokens(inCode: boolean): ImapToken[] {
    const tokens: ImapToken[] = [];
    for (;;) {
      this.space();
      const c = this.peek();
      if (c === -1 || (inCode && c === RBRACKET)) return tokens;
      tokens.push(this.token(inCode));
    }
  }

  token(inCode: boolean): ImapToken {
    const c = this.peek();
    if (c === LPAREN) {
      this.pos++;
      const items: ImapToken[] = [];
      for (;;) {
        this.space();
        const next = this.peek();
        if (next === RPAREN) {
          this.pos++;
          return { type: "list", items };
        }
        if (next === -1) throw new ImapParseError("Unclosed list", this.bytes, this.pos);
        items.push(this.token(inCode));
      }
    }
    if (c === QUOTE) return { type: "string", value: this.quoted() };
    if (c === LBRACE || (c === TILDE && this.bytes[this.pos + 1] === LBRACE)) {
      return { type: "literal", bytes: this.literal() };
    }
    const value = this.atom(inCode);
    if (!value)
      throw new ImapParseError(`Unexpected "${String.fromCharCode(c)}"`, this.bytes, this.pos);
    return value.toUpperCase() === "NIL" ? { type: "nil" } : { type: "atom", value };
  }

  /**
   * An atom, number or flag (`\Seen`). A `[` inside one runs to its `]`, so a
   * fetch item like `BODY[HEADER.FIELDS (SUBJECT)]<0>` stays one atom. A
   * literal ends one even without a space (GreenMail sends `BODY[TEXT]<0>{64}`).
   */
  atom(inCode: boolean): string {
    const from = this.pos;
    for (;;) {
      const c = this.peek();
      if (
        c === -1 ||
        c === SP ||
        c === LPAREN ||
        c === RPAREN ||
        c === QUOTE ||
        c === CR ||
        c === LF ||
        c === LBRACE ||
        (c === TILDE && this.bytes[this.pos + 1] === LBRACE) ||
        (inCode && c === RBRACKET)
      ) {
        break;
      }
      if (c === LBRACKET && !inCode) {
        const close = this.bytes.subarray(0, this.end).indexOf(RBRACKET, this.pos);
        this.pos = close < 0 ? this.end : close + 1;
        continue;
      }
      this.pos++;
    }
    return utf8Decode(this.bytes.subarray(from, this.pos));
  }

  quoted(): string {
    this.pos++;
    const out: number[] = [];
    for (;;) {
      const c = this.peek();
      if (c === -1) throw new ImapParseError("Unclosed string", this.bytes, this.pos);
      this.pos++;
      if (c === QUOTE) return utf8Decode(new Uint8Array(out));
      if (c === BACKSLASH && this.pos < this.end) out.push(this.bytes[this.pos++]!);
      else out.push(c);
    }
  }

  literal(): Uint8Array {
    if (this.peek() === TILDE) this.pos++;
    const close = this.bytes.subarray(0, this.end).indexOf(RBRACE, this.pos);
    const size = Number.parseInt(utf8Decode(this.bytes.subarray(this.pos + 1, close)), 10);
    if (close < 0 || !Number.isFinite(size))
      throw new ImapParseError("Bad literal", this.bytes, this.pos);
    let start = close + 1;
    if (this.bytes[start] === CR) start++;
    if (this.bytes[start] === LF) start++;
    if (start + size > this.end) throw new ImapParseError("Short literal", this.bytes, this.pos);
    this.pos = start + size;
    return this.bytes.subarray(start, start + size);
  }
}

export function tokenText(token: ImapToken | undefined): string | null {
  switch (token?.type) {
    case "atom":
    case "string":
      return token.value;
    case "literal":
      return utf8Decode(token.bytes);
    default:
      return null;
  }
}

export const tokenNumber = (token: ImapToken | undefined): number | null => {
  const text = tokenText(token);
  return text !== null && /^\d+$/.test(text) ? Number(text) : null;
};

export const tokenList = (token: ImapToken | undefined): ImapToken[] =>
  token?.type === "list" ? token.items : [];

export const tokenBytes = (token: ImapToken | undefined): Uint8Array | null =>
  token?.type === "literal"
    ? token.bytes
    : token?.type === "string" || token?.type === "atom"
      ? utf8Encode(token.value)
      : null;
