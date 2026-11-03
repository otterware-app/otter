import { decodeWords } from "postal-mime";
import { utf8Decode, utf8Encode } from "../../bytes.js";
import {
  tokenBytes,
  tokenList,
  tokenNumber,
  tokenText,
  type ImapResponse,
  type ImapToken,
} from "./parser.js";

export interface ImapAddress {
  name: string;
  address: string;
}

export interface ImapEnvelope {
  date: Date | null;
  subject: string;
  from: ImapAddress[];
  sender: ImapAddress[];
  replyTo: ImapAddress[];
  to: ImapAddress[];
  cc: ImapAddress[];
  bcc: ImapAddress[];
  inReplyTo: string | null;
  messageId: string | null;
}

export interface BodyStructure {
  part: string;
  /** Lower-cased, "text/plain". */
  type: string;
  /** Content-Type parameters (charset, name, boundary), lower-cased keys. */
  parameters: Record<string, string>;
  id: string | null;
  description: string | null;
  encoding: string | null;
  size: number | null;
  /** "attachment" or "inline", lower-cased; null without Content-Disposition. */
  disposition: string | null;
  dispositionParameters: Record<string, string>;
  filename: string | null;
  /** A multipart's parts, or a message/rfc822's own body. */
  childNodes: BodyStructure[];
  envelope?: ImapEnvelope;
}

export interface FetchedMessage {
  seq: number;
  uid: number;
  flags?: string[];
  /** CONDSTORE's mod-sequence: up to 2^63, so a bigint. */
  modseq?: bigint;
  envelope?: ImapEnvelope;
  bodyStructure?: BodyStructure;
  internalDate?: Date;
  size?: number;
  /** The header fields asked for, lower-cased names (the first of repeated ones), decoded. */
  headers?: Record<string, string>;
  source?: Uint8Array;
  textStart?: Uint8Array;
  gmailId?: bigint;
  gmailThreadId?: bigint;
  /** Gmail's X-GM-LABELS, as sent (modified UTF-7; system labels as \Inbox, \Sent, …). */
  gmailLabels?: string[];
}

export function parseFetch(response: ImapResponse): FetchedMessage {
  const message: FetchedMessage = { seq: response.number ?? 0, uid: 0 };
  const items = tokenList(response.args[0]);
  for (let i = 0; i + 1 < items.length; i += 2) {
    const key = (tokenText(items[i]) ?? "").toUpperCase();
    const value = items[i + 1];
    if (key === "UID") message.uid = tokenNumber(value) ?? 0;
    else if (key === "FLAGS") message.flags = tokenList(value).map((flag) => tokenText(flag) ?? "");
    else if (key === "MODSEQ") message.modseq = toBigInt(tokenList(value)[0]);
    else if (key === "ENVELOPE") message.envelope = parseEnvelope(value);
    else if (key === "BODYSTRUCTURE" || key === "BODY") {
      message.bodyStructure = parseBodyStructure(value);
    } else if (key === "INTERNALDATE") {
      message.internalDate = parseInternalDate(tokenText(value) ?? "") ?? undefined;
    } else if (key === "RFC822.SIZE") message.size = tokenNumber(value) ?? undefined;
    else if (key.startsWith("BODY[HEADER") || key === "RFC822.HEADER") {
      message.headers = parseHeaders(tokenBytes(value) ?? new Uint8Array());
    } else if (/^(BODY|BINARY)\[\](<0>)?$/.test(key) || key === "RFC822") {
      message.source = tokenBytes(value) ?? new Uint8Array();
    } else if (key.startsWith("BODY[TEXT]")) {
      message.textStart = tokenBytes(value) ?? new Uint8Array();
    } else if (key === "X-GM-MSGID") message.gmailId = toBigInt(value);
    else if (key === "X-GM-THRID") message.gmailThreadId = toBigInt(value);
    else if (key === "X-GM-LABELS") {
      message.gmailLabels = tokenList(value).map((label) => tokenText(label) ?? "");
    }
  }
  return message;
}

export function parseEnvelope(token: ImapToken | undefined): ImapEnvelope {
  const [date, subject, from, sender, replyTo, to, cc, bcc, inReplyTo, messageId] =
    tokenList(token);
  const dateText = tokenText(date);
  const parsed = dateText ? new Date(dateText.replace(/\s*\([^)]*\)\s*$/, "")) : null;
  return {
    date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    subject: decodeHeader(tokenText(subject) ?? ""),
    from: parseAddresses(from),
    sender: parseAddresses(sender),
    replyTo: parseAddresses(replyTo),
    to: parseAddresses(to),
    cc: parseAddresses(cc),
    bcc: parseAddresses(bcc),
    inReplyTo: tokenText(inReplyTo),
    messageId: tokenText(messageId),
  };
}

function parseAddresses(token: ImapToken | undefined): ImapAddress[] {
  const addresses: ImapAddress[] = [];
  for (const entry of tokenList(token)) {
    const [name, , mailbox, host] = tokenList(entry);
    const hostText = tokenText(host);
    const mailboxText = tokenText(mailbox);
    if (hostText === null) continue;
    addresses.push({
      name: decodeHeader(tokenText(name) ?? ""),
      address: mailboxText ? `${mailboxText}@${hostText}` : hostText,
    });
  }
  return addresses;
}

export function parseBodyStructure(
  token: ImapToken | undefined,
  part: string | null = null,
): BodyStructure {
  const fields = tokenList(token);
  if (fields[0]?.type === "list") {
    let index = 0;
    const childNodes: BodyStructure[] = [];
    while (fields[index]?.type === "list") {
      const number = String(index + 1);
      childNodes.push(parseBodyStructure(fields[index], part ? `${part}.${number}` : number));
      index++;
    }
    const [subtype, params, disposition] = fields.slice(index);
    return {
      ...describe("multipart", subtype, params, disposition),
      part: part ?? "",
      id: null,
      description: null,
      encoding: null,
      size: null,
      childNodes,
    };
  }

  const own = part ?? "1";
  const [type, subtype, params, id, description, encoding, size, ...rest] = fields;
  const mimeType = (tokenText(type) ?? "application").toLowerCase();
  const mimeSubtype = (tokenText(subtype) ?? "octet-stream").toLowerCase();
  let extension = rest;
  const node: Partial<BodyStructure> = {};
  if (mimeType === "message" && (mimeSubtype === "rfc822" || mimeSubtype === "global")) {
    const [envelope, body] = rest;
    node.envelope = parseEnvelope(envelope);
    const inner = tokenList(body);
    node.childNodes = [parseBodyStructure(body, inner[0]?.type === "list" ? own : `${own}.1`)];
    extension = rest.slice(3);
  } else if (mimeType === "text") {
    extension = rest.slice(1);
  }
  const [, disposition] = extension;
  return {
    ...describe(mimeType, subtype, params, disposition),
    part: own,
    id: tokenText(id),
    description: tokenText(description),
    encoding: tokenText(encoding)?.toLowerCase() ?? null,
    size: tokenNumber(size),
    childNodes: [],
    ...node,
  };
}

function describe(
  type: string,
  subtype: ImapToken | undefined,
  params: ImapToken | undefined,
  disposition: ImapToken | undefined,
) {
  const parameters = parseParameters(params);
  const [dispositionType, dispositionParams] = tokenList(disposition);
  const dispositionParameters = parseParameters(dispositionParams);
  return {
    type: `${type}/${(tokenText(subtype) ?? "mixed").toLowerCase()}`,
    parameters,
    disposition: tokenText(dispositionType)?.toLowerCase() ?? null,
    dispositionParameters,
    filename: dispositionParameters.filename ?? parameters.name ?? null,
  };
}

/**
 * `("charset" "utf-8" "name" "=?UTF-8?Q?…?=")`, with encoded words decoded and
 * RFC 2231's `filename*0*=utf-8''…` pieces put back together.
 */
function parseParameters(token: ImapToken | undefined): Record<string, string> {
  const items = tokenList(token);
  const out: Record<string, string> = {};
  const pieces: Record<string, { index: number; value: string; encoded: boolean }[]> = {};
  for (let i = 0; i + 1 < items.length; i += 2) {
    const key = (tokenText(items[i]) ?? "").toLowerCase();
    const value = tokenText(items[i + 1]) ?? "";
    const continued = /^([^*]+)\*(\d+)?(\*)?$/.exec(key);
    if (!continued) {
      out[key] = decodeHeader(value);
      continue;
    }
    const [, name, index, star] = continued;
    (pieces[name!] ??= []).push({
      index: Number(index ?? 0),
      value,
      encoded: index === undefined || star !== undefined,
    });
  }
  for (const [name, list] of Object.entries(pieces)) {
    list.sort((a, b) => a.index - b.index);
    let charset = "utf-8";
    const bytes: number[] = [];
    for (const [i, piece] of list.entries()) {
      let value = piece.value;
      if (piece.encoded && i === 0) {
        const match = /^([^']*)'[^']*'(.*)$/.exec(value);
        if (match) [, charset = "utf-8", value = ""] = match;
      }
      if (!piece.encoded) {
        for (const byte of utf8Encode(value)) bytes.push(byte);
        continue;
      }
      for (let j = 0; j < value.length; j++) {
        const hex = value[j] === "%" ? value.slice(j + 1, j + 3) : "";
        if (/^[\da-f]{2}$/i.test(hex)) {
          bytes.push(Number.parseInt(hex, 16));
          j += 2;
        } else {
          bytes.push(value.charCodeAt(j) & 0xff);
        }
      }
    }
    out[name] = decodeCharset(new Uint8Array(bytes), charset);
  }
  return out;
}

function decodeCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return utf8Decode(bytes);
  }
}

export function decodeHeader(value: string): string {
  return value.includes("=?") ? decodeWords(value) : value;
}

/** Header fields from BODY[HEADER…]: unfolded, names lower-cased, values decoded. */
export function parseHeaders(bytes: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  const text = utf8Decode(bytes).replace(/\r?\n[ \t]+/g, " ");
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    headers[name] ??= decodeHeader(line.slice(colon + 1).trim());
  }
  return headers;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseInternalDate(text: string): Date | null {
  const match = /^\s*(\d{1,2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(
    text,
  );
  if (!match) return null;
  const [, day, month, year, hour, minute, second, sign, zoneHours, zoneMinutes] = match;
  const monthIndex = MONTHS.findIndex((name) => name.toLowerCase() === month!.toLowerCase());
  if (monthIndex < 0) return null;
  const offset = (sign === "-" ? -1 : 1) * (Number(zoneHours) * 60 + Number(zoneMinutes));
  const utc = Date.UTC(+year!, monthIndex, +day!, +hour!, +minute!, +second!);
  return new Date(utc - offset * 60_000);
}

export function formatInternalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
}

export function uidSet(uids: readonly number[] | string): string {
  if (typeof uids === "string") return uids;
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    while (sorted[i + 1] === sorted[i]! + 1) i++;
    ranges.push(start === sorted[i] ? String(start) : `${start}:${sorted[i]}`);
  }
  return ranges.join(",");
}

export type UidRange = [from: number, to: number];

const MAX_UID = 4_294_967_295;

const isUid = (n: number | undefined): n is number =>
  n !== undefined && Number.isInteger(n) && n > 0 && n <= MAX_UID;

/** "1:3,5,9:8" → [[1, 3], [5, 5], [8, 9]], never expanded (VANISHED may name 1:4294967295). */
export function parseUidRanges(text: string): UidRange[] {
  const ranges: UidRange[] = [];
  for (const range of text.split(",")) {
    const [from, to = from] = range.split(":").map(Number);
    if (!isUid(from) || !isUid(to)) continue;
    ranges.push(from <= to ? [from, to] : [to, from]);
  }
  return ranges;
}

export function inUidRanges(ranges: readonly UidRange[]): (uid: number) => boolean {
  const sorted: UidRange[] = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = sorted.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else sorted.push([from, to]);
  }
  return (uid) => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [from, to] = sorted[mid]!;
      if (uid < from) high = mid - 1;
      else if (uid > to) low = mid + 1;
      else return true;
    }
    return false;
  };
}

/**
 * "1:3,5" → [1, 2, 3, 5] (in the server's order: COPYUID pairs them up by
 * position); null when that would be more than `limit` UIDs.
 */
export function parseUidSet(text: string, limit = 100_000): number[] | null {
  const uids: number[] = [];
  for (const range of text.split(",")) {
    const [from, to = from] = range.split(":").map(Number);
    if (!isUid(from) || !isUid(to)) continue;
    if (uids.length + Math.abs(to - from) + 1 > limit) return null;
    const step = to >= from ? 1 : -1;
    for (let uid = from; uid !== to + step; uid += step) uids.push(uid);
  }
  return uids;
}

export function toBigInt(token: ImapToken | undefined): bigint | undefined {
  const text = tokenText(token);
  return text && /^\d+$/.test(text) ? BigInt(text) : undefined;
}
