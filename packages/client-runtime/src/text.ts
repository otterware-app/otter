/**
 * Decode HTML entities in text meant to render as plain text. Gmail's message
 * `snippet` is HTML-encoded (e.g. `It&#39;s`), so it needs decoding before it
 * shows in list/collapsed rows. Short-circuits when there's nothing to decode.
 */
export function decodeEntities(input: string): string {
  if (!input || input.indexOf("&") === -1) return input;
  return input
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so a single-encoded string never double-decodes
}
