import { fromBase64, randomHex, toBase64, utf8Encode } from "../bytes.js";
import { platform } from "../platform.js";
import type { ComposeAttachment, MailAccount } from "../types.js";

const CRLF = "\r\n";

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * RFC 2047 B-encoded word(s), chunked by code point so UTF-8 byte sequences
 * never split across words; continuation words are folded onto new lines.
 */
function encodeWords(value: string): string {
  const MAX_BYTES = 45; // "=?UTF-8?B?" + base64(45B → 60ch) + "?=" = 72 chars ≤ 75
  const chunks: string[] = [];
  let current = "";
  for (const ch of value) {
    if (current && utf8Encode(current + ch).length > MAX_BYTES) {
      chunks.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c) => `=?UTF-8?B?${toBase64(utf8Encode(c))}?=`).join(`${CRLF} `);
}

function encodeHeaderValue(value: string): string {
  return isPrintableAscii(value) ? value : encodeWords(value);
}

export function formatAddress(name: string, email: string): string {
  if (!name || name === email) return email;
  if (!isPrintableAscii(name)) return `${encodeWords(name)} <${email}>`;
  if (/[^A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~.]/.test(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  }
  return `${name} <${email}>`;
}

// One bare address: no whitespace, control characters or address-list delimiters, so it's safe
// as the From header and the SMTP envelope sender.
const ADDRESS_PART = String.raw`[^\s\x00-\x1f\x7f@<>()[\]\\,;:"]+`;
const SINGLE_ADDRESS = new RegExp(`^${ADDRESS_PART}@${ADDRESS_PART}\\.${ADDRESS_PART}$`);

export function isSingleAddress(value: string): boolean {
  return SINGLE_ADDRESS.test(value);
}

/**
 * Who a message goes out from: the mailbox's own address, or `from` when it's one of the other
 * addresses the mailbox sends from (`sendAs`). Anything else is refused, never quietly replaced.
 * A draft (`draft: true`) may keep an address the mailbox no longer has, so editing it never
 * fails; it can't be sent from that address.
 */
export function senderOf(
  account: MailAccount,
  from?: string,
  {
    name = account.displayName || account.name,
    draft = false,
  }: { name?: string; draft?: boolean } = {},
): { email: string; from: string } {
  const email =
    !from || from.toLowerCase() === account.email.toLowerCase()
      ? account.email
      : (account.sendAs?.find((address) => address.toLowerCase() === from.toLowerCase()) ??
        (draft && isSingleAddress(from) ? from : undefined));
  if (!email) throw new Error(`${account.email} can't send from ${from}.`);
  return { email, from: formatAddress(name, email) };
}

/**
 * Split a user-typed address list on commas outside double quotes. CR/LF are
 * collapsed to spaces — a raw newline in an entry would otherwise terminate
 * the To/Cc/Bcc header line mid-value (header injection).
 */
export function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.replace(/[\r\n]+/g, " ").trim()).filter((p) => p.length > 0);
}

function encodeAddressList(value: string): string {
  return splitAddressList(value)
    .map((entry) => {
      const match = entry.match(/^(.*?)\s*<([^>]+)>$/);
      if (!match) return entry;
      const name = match[1].trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
      return formatAddress(name, match[2].trim());
    })
    .join(", ");
}

function wrapBase64(base64: string): string {
  return base64.match(/.{1,76}/g)?.join(CRLF) ?? "";
}

function attachmentHeaders(att: { name: string; mimeType: string }): string[] {
  const mimeType = att.mimeType || "application/octet-stream";
  if (isPrintableAscii(att.name) && !/["\\]/.test(att.name)) {
    return [
      `Content-Type: ${mimeType}; name="${att.name}"`,
      `Content-Disposition: attachment; filename="${att.name}"`,
    ];
  }
  // RFC 2231 extended parameter + RFC 2047 fallback for legacy clients.
  const extended = `UTF-8''${encodeURIComponent(att.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  const fallback = encodeWords(att.name).split(`${CRLF} `).join(" ");
  return [
    `Content-Type: ${mimeType}`,
    `Content-Disposition: attachment; filename="${fallback}"; filename*=${extended}`,
  ];
}

export interface OutgoingMessage {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: ComposeAttachment[];
}

export function buildMime(params: OutgoingMessage): string {
  const headers: string[] = [`From: ${params.from}`];
  if (params.to) headers.push(`To: ${encodeAddressList(params.to)}`);
  if (params.cc) headers.push(`Cc: ${encodeAddressList(params.cc)}`);
  if (params.bcc) headers.push(`Bcc: ${encodeAddressList(params.bcc)}`);
  headers.push(`Subject: ${encodeHeaderValue(params.subject)}`);
  if (params.inReplyTo) headers.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) {
    // One message id per folded line keeps long reply chains within line limits.
    headers.push(`References: ${params.references.split(/\s+/).filter(Boolean).join(`${CRLF} `)}`);
  }
  headers.push("MIME-Version: 1.0");

  const bodyBase64 = wrapBase64(toBase64(utf8Encode(params.body)));
  const textPart = [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    bodyBase64,
  ];

  let bodyEntity = textPart;
  if (params.bodyHtml) {
    const altBoundary = `otter_alt_${randomHex(12)}`;
    const htmlPart = [
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(toBase64(utf8Encode(params.bodyHtml))),
    ];
    bodyEntity = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      [`--${altBoundary}`, ...textPart].join(CRLF),
      [`--${altBoundary}`, ...htmlPart].join(CRLF),
      `--${altBoundary}--`,
    ];
  }

  const attachments = params.attachments ?? [];
  if (attachments.length === 0) {
    return [...headers, ...bodyEntity].join(CRLF);
  }

  const boundary = `otter_${randomHex(12)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [[`--${boundary}`, ...bodyEntity].join(CRLF)];
  for (const att of attachments) {
    parts.push(
      [
        `--${boundary}`,
        ...attachmentHeaders(att),
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(toBase64(fromBase64(att.base64))),
      ].join(CRLF),
    );
  }
  return [headers.join(CRLF), "", parts.join(CRLF), `--${boundary}--`].join(CRLF);
}

export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export async function pickComposeAttachments(
  existingBytes: number,
): Promise<{ attachments: ComposeAttachment[]; error?: string }> {
  const picked = await platform().userFiles.pick();
  const total = picked.reduce((sum, file) => sum + file.bytes.length, existingBytes);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return { attachments: [], error: "Attachments can total at most 25 MB." };
  }
  return {
    attachments: picked.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.bytes.length,
      base64: toBase64(file.bytes),
    })),
  };
}
