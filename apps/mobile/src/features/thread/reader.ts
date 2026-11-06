import type { MailCapabilities } from "@otter-mail/contracts";

/** apps/ios's Quote.split: a plain-text message's own words, and the quoted rest after them. */
export function splitQuote(text: string): { body: string; quote: string | null } {
  const match = /\n+(On .{4,200}wrote:\s*\n|>)/.exec(text);
  if (!match) return { body: text, quote: null };
  const rest = text.slice(match.index + match[0].length);
  if (match[1] !== ">" && !rest.includes(">")) return { body: text, quote: null };
  const body = text.slice(0, match.index).trim();
  return body ? { body, quote: text.slice(match.index) } : { body: text, quote: null };
}

/** apps/ios's ThreadView: the last message open, and every unread one; the rest folded until tapped. */
export const isOpen = (
  message: { id: string; unread: boolean },
  lastId: string | undefined,
  expanded: ReadonlySet<string>,
) => message.id === lastId || message.unread || expanded.has(message.id);

export type AdvanceDirection = "next" | "previous" | "none";

export const advanceDirection = (value: string | undefined): AdvanceDirection =>
  value === "previous" || value === "none" ? value : "next";

/**
 * Where the reader goes after archiving or trashing (Settings › After archive):
 * the conversation after it in the list as it was opened, or before it, of those
 * still there; nothing goes back to the list.
 */
export function advanceTarget<T extends { threadId: string }>(
  siblings: readonly T[],
  current: string,
  remaining: ReadonlySet<string>,
  direction: AdvanceDirection,
): T | null {
  if (direction === "none") return null;
  const index = Math.max(
    0,
    siblings.findIndex((s) => s.threadId === current),
  );
  const left = (s: T) => s.threadId !== current && remaining.has(s.threadId);
  const after = siblings.slice(index + 1).find(left) ?? null;
  const before = siblings.slice(0, index).findLast(left) ?? null;
  return direction === "previous" ? (before ?? after) : (after ?? before);
}

/** Gmail stars; Outlook and IMAP flag (apps/ios's `mailbox.mark`). */
export const mark = (capabilities: MailCapabilities | undefined) =>
  capabilities && capabilities.stars !== true
    ? ({ verb: "Flag", undo: "Unflag", symbol: "flag", place: "Flagged" } as const)
    : ({ verb: "Star", undo: "Unstar", symbol: "star", place: "Starred" } as const);

/** "to me, Ana, cc Bo": a message's recipients, the mailbox's own addresses as "me". */
export function recipientsLine(to: string, cc: string | undefined, mine: ReadonlySet<string>) {
  const names = (list: string) =>
    splitAddresses(list)
      .map((entry) => {
        const email = /<([^>]+)>/.exec(entry)?.[1] ?? entry;
        if (mine.has(email.trim().toLowerCase())) return "me";
        const name = entry
          .replace(/<[^>]*>/, "")
          .replace(/^"|"$/g, "")
          .trim();
        return name.replace(/^"|"$/g, "") || email.trim();
      })
      .join(", ");
  const line = to ? `to ${names(to)}` : "";
  return cc ? `${line}, cc ${names(cc)}` : line;
}

/** Addresses in a header list, commas inside quotes and angle brackets kept (Draft.tokens). */
export function splitAddresses(raw: string): string[] {
  const out: string[] = [];
  let token = "";
  let quoted = false;
  let escaped = false;
  let angle = false;
  for (const c of raw) {
    if (escaped) {
      token += c;
      escaped = false;
      continue;
    }
    if (c === "\\" && quoted) {
      token += c;
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted) {
      if (c === "<") angle = true;
      if (c === ">") angle = false;
    }
    if (!quoted && !angle && (c === "," || c === ";" || c === "\n")) {
      if (token.trim()) out.push(token.trim());
      token = "";
    } else token += c;
  }
  if (token.trim()) out.push(token.trim());
  return out;
}

/** HTML to readable text, for Copy and Translate of an HTML message. */
export function htmlText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Translation's language codes match on their language alone ("en-GB" reads "en"). */
export const sameLanguage = (a: string, b: string) =>
  a.split("-")[0]!.toLowerCase() === b.split("-")[0]!.toLowerCase();

const units = ["bytes", "KB", "MB", "GB"];

/** ByteCountFormatStyle's file sizes: "820 bytes", "14 KB", "2.1 MB". */
export function fileSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const shown = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${units[unit]}`;
}
