/** How a file shows: what each app's preview draws it as. */
export type PreviewKind =
  | "pdf"
  | "html"
  | "markdown"
  | "table"
  | "text"
  | "image"
  | "video"
  | "audio";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  htm: "text/html",
  html: "text/html",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  webm: "video/webm",
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  json: "application/json",
  log: "text/plain",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

const MEDIA_MIME =
  /^(image\/(avif|bmp|gif|x-icon|vnd\.microsoft\.icon|jpeg|png|svg\+xml|webp)|video\/(mp4|quicktime|webm)|audio\/(aac|flac|mp4|x-m4a|mpeg|mp3|ogg|wav|x-wav|webm))$/;

/**
 * What an attachment previews as, and the type to show it with. Mail often
 * labels files `application/octet-stream` (or `text/plain`), so a generic
 * type defers to the extension.
 */
export function attachmentPreview(
  name: string,
  mimeType: string,
): { kind: PreviewKind; mimeType: string } | null {
  let mime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!mime || mime === "application/octet-stream" || mime === "text/plain") {
    const extension = name.toLowerCase().split(".").at(-1) ?? "";
    mime = MIME_BY_EXTENSION[extension] ?? mime;
  }
  const kind: PreviewKind | null =
    mime === "application/pdf"
      ? "pdf"
      : mime === "text/html"
        ? "html"
        : mime === "text/markdown" || mime === "text/x-markdown"
          ? "markdown"
          : mime === "text/csv" || mime === "text/tab-separated-values"
            ? "table"
            : MEDIA_MIME.test(mime)
              ? (mime.split("/")[0] as "image" | "video" | "audio")
              : mime.startsWith("text/") ||
                  /^application\/(json|.*\+json|xml|.*\+xml|javascript|yaml|x-yaml|toml|sql)$/.test(
                    mime,
                  )
                ? "text"
                : null;
  return kind ? { kind, mimeType: mime } : null;
}

export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export type DecodedText = { text: string; truncated: boolean };

/** Rejects binary data rather than showing replacement characters as a document. */
export function decodeText(bytes: Uint8Array): DecodedText {
  const bounded = bytes.subarray(0, TEXT_PREVIEW_MAX_BYTES);
  if (bounded.includes(0)) throw new Error("This file contains binary data.");
  const truncated = bytes.length > bounded.length;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bounded, { stream: truncated }),
      truncated,
    };
  } catch {
    throw new Error("This file is not UTF-8 text.");
  }
}

/** A page's source, when it's UTF-8: a page in another charset still renders, without its source. */
export function decodeHtmlSource(bytes: Uint8Array): DecodedText | null {
  try {
    return decodeText(bytes);
  } catch {
    return null;
  }
}

export const MEDIA_KINDS = new Set<PreviewKind>(["image", "video", "audio"]);

/** A CSV or TSV file's first 100 rows of up to 30 cells, each cut at 2,000 characters. */
export function parseDelimited(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  let rowStart = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endCell = () => {
    if (row.length < 30) row.push(cell);
    else truncated = true;
    cell = "";
  };
  for (let index = rowStart; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        if (cell.length < 2000) cell += '"';
        else truncated = true;
        index++;
        continue;
      }
      if (quoted || cell === "") {
        quoted = !quoted;
        continue;
      }
    }
    if (!quoted && (char === delimiter || char === "\n" || char === "\r")) {
      endCell();
      if (char !== delimiter) {
        rows.push(row);
        row = [];
        if (char === "\r" && text[index + 1] === "\n") index++;
        rowStart = index + 1;
        if (rows.length === 100) return { rows, truncated: truncated || index < text.length - 1 };
      }
    } else if (cell.length < 2000) cell += char;
    else truncated = true;
  }
  if (rowStart < text.length) {
    endCell();
    rows.push(row);
  }
  return { rows, truncated: truncated || quoted };
}

/** A file's bytes, from the base64 core sends them in. */
export const bytesOfBase64 = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
