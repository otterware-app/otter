import PostalMime from "postal-mime";
import { utf8Encode } from "../bytes.js";

export interface ParsedAttachment {
  filename: string | null;
  mimeType: string;
  /** Without angle brackets, as `cid:` URLs in the HTML refer to it. */
  contentId: string | null;
  disposition: "attachment" | "inline" | null;
  bytes: Uint8Array;
}

export interface ParsedMessage {
  html: string | null;
  text: string | null;
  attachments: ParsedAttachment[];
  /** Every header in order, names lower-cased, values as sent (encoded words and all). */
  headers: { name: string; value: string }[];
}

export async function parseMessage(source: Uint8Array | string): Promise<ParsedMessage> {
  const email = await PostalMime.parse(source, { attachmentEncoding: "arraybuffer" });
  return {
    html: email.html ?? null,
    text: email.text ?? null,
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      contentId: attachment.contentId?.replace(/^<|>$/g, "") || null,
      disposition:
        attachment.disposition === "attachment"
          ? "attachment"
          : attachment.disposition === "inline"
            ? "inline"
            : null,
      bytes:
        typeof attachment.content === "string"
          ? utf8Encode(attachment.content)
          : new Uint8Array(attachment.content),
    })),
    headers: email.headers.map((header) => ({ name: header.key, value: header.value })),
  };
}
