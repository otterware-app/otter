/**
 * Files attached to an agent chat turn (pasted, dropped, or picked).
 * Each is copied into the app's assistant-attachments folder, so the agent
 * reads a stable copy that outlives the original (a dragged Downloads file, a
 * pasted screenshot that only ever existed in memory).
 */

import { toBase64 } from "../../bytes.js";
import { platform } from "../../platform.js";
import type { ChatAttachment } from "./types.js";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const ATTACHMENTS_DIR = "assistant-attachments";

function limitFor(mime: string): number {
  return mime.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const DOCUMENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".eml": "message/rfc822",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeFor(name: string, fallback?: string): string {
  const ext = /\.[^./]+$/.exec(name)?.[0].toLowerCase() ?? "";
  return IMAGE_TYPES[ext] ?? DOCUMENT_TYPES[ext] ?? (fallback || "application/octet-stream");
}

function safeName(name: string): string {
  const base = name.replace(/[^\w.\- ()]+/g, "_").slice(-120);
  return base || "attachment";
}

export async function stageAttachment(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<ChatAttachment> {
  const type = mimeFor(name, mime);
  if (bytes.byteLength === 0) throw new Error(`'${name}' is empty or could not be read.`);
  if (bytes.byteLength > limitFor(type)) {
    throw new Error(`'${name}' exceeds the ${limitFor(type) / 1024 / 1024} MB attachment limit.`);
  }
  const id = crypto.randomUUID();
  const file = `${ATTACHMENTS_DIR}/${id.slice(0, 8)}-${safeName(name)}`;
  await platform().files.write(file, bytes);
  return {
    id,
    name,
    mime: type,
    size: bytes.byteLength,
    path: file,
    kind: type.startsWith("image/") ? "image" : "file",
  };
}

export async function readAttachment(attachment: ChatAttachment): Promise<Uint8Array> {
  const bytes = await platform().files.read(attachment.path);
  if (!bytes) throw new Error(`'${attachment.name}' is no longer attached.`);
  return bytes;
}

export async function dataUrl(attachment: ChatAttachment): Promise<string> {
  return `data:${attachment.mime};base64,${toBase64(await readAttachment(attachment))}`;
}
