/**
 * Modified UTF-7 (RFC 3501 §5.1.3), how IMAP servers without UTF8=ACCEPT
 * spell mailbox names: printable ASCII as is, "&" as "&-", anything else as
 * UTF-16 in base64 (with "," for "/") between "&" and "-".
 */

import { fromBase64, toBase64 } from "../../bytes.ts";

export function encodeMailboxName(name: string): string {
  let out = "";
  let pending: number[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    const bytes = new Uint8Array(pending.length * 2);
    pending.forEach((unit, i) => {
      bytes[i * 2] = unit >> 8;
      bytes[i * 2 + 1] = unit & 0xff;
    });
    out += `&${toBase64(bytes).replace(/=+$/, "").replace(/\//g, ",")}-`;
    pending = [];
  };
  for (let i = 0; i < name.length; i++) {
    const unit = name.charCodeAt(i);
    if (unit >= 0x20 && unit <= 0x7e) {
      flush();
      out += unit === 0x26 ? "&-" : name[i];
    } else {
      pending.push(unit);
    }
  }
  flush();
  return out;
}

export function decodeMailboxName(name: string): string {
  return name.replace(/&([^-]*)-/g, (_, encoded: string) => {
    if (!encoded) return "&";
    const bytes = fromBase64(encoded.replace(/,/g, "/"));
    let text = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      text += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    }
    return text;
  });
}
