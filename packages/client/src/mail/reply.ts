import { formatAddressEntry, parseAddressEntry, splitAddressList } from "./address.ts";
import { formatFullDate } from "./format.ts";
import type { MessageSummary } from "./types.ts";

export function splitPlainQuote(text: string): [string, string] {
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const quoteRunFollows = lines
      .slice(i)
      .every((l) => l.trim() === "" || l.trimStart().startsWith(">"));
    if (
      /^On .+wrote:$/i.test(line) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line) ||
      (line.startsWith(">") && quoteRunFollows)
    ) {
      const main = lines.slice(0, i).join("\n").trimEnd();
      if (main.trim().length < 20) return [text, ""];
      return [main, lines.slice(i).join("\n")];
    }
  }
  return [text, ""];
}

export function computeReplyAll(
  last: MessageSummary & { cc?: string; replyTo?: string },
  ownAddresses: string[],
): { to: string; cc: string | undefined } {
  const own = ownAddresses.map((a) => a.toLowerCase());
  const fromSelf = own.includes(last.fromEmail.toLowerCase());
  const seen = new Set<string>(own);
  const to: string[] = [];
  const cc: string[] = [];
  if (!fromSelf) {
    for (const entry of splitAddressList(replyTarget(last))) {
      const email = parseAddressEntry(entry).email.toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      to.push(entry);
    }
    seen.add(last.fromEmail.toLowerCase());
  }
  for (const entry of splitAddressList(last.to)) {
    const email = parseAddressEntry(entry).email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (fromSelf ? to : cc).push(entry);
  }
  for (const entry of splitAddressList(last.cc ?? "")) {
    const email = parseAddressEntry(entry).email.toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    cc.push(entry);
  }
  if (to.length === 0) to.push(senderAddress(last));
  return { to: to.join(", "), cc: cc.length > 0 ? cc.join(", ") : undefined };
}

function senderAddress(m: MessageSummary): string {
  return formatAddressEntry(m.fromName, m.fromEmail);
}

/** Where a reply goes: Reply-To when the sender set one, else From. */
function replyTarget(m: MessageSummary & { replyTo?: string }): string {
  return m.replyTo || senderAddress(m);
}

export function computeReply(
  last: MessageSummary & { replyTo?: string },
  ownAddresses: string[],
): { to: string; cc: string | undefined } {
  const fromSelf = ownAddresses.some((a) => a.toLowerCase() === last.fromEmail.toLowerCase());
  // Replying to your own message targets its recipients instead of yourself.
  return { to: fromSelf ? last.to : replyTarget(last), cc: undefined };
}

export function prefixSubject(prefix: "Re" | "Fwd", subject: string): string {
  const already = prefix === "Re" ? /^re:/i : /^(fwd?|fw):/i;
  return already.test(subject.trim()) ? subject : `${prefix}: ${subject}`;
}

export function replyBlock(
  source: MessageSummary & { bodyText?: string | null; bodyHtml?: string | null },
  htmlToText: (html: string) => string,
): string {
  const body = source.bodyText ?? (source.bodyHtml ? htmlToText(source.bodyHtml) : "");
  if (!body.trim()) return "";
  const from = source.fromName || source.fromEmail;
  const quote = body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${formatFullDate(source.date)}, ${from} wrote:\n${quote}`;
}

/** What a forward quotes: the message's text, or its HTML's (`htmlToText`). */
export function forwardBlock(
  source: MessageSummary & { bodyText?: string | null; bodyHtml?: string | null },
  htmlToText: (html: string) => string,
): string {
  const fromDisplay = source.fromName
    ? `${source.fromName} <${source.fromEmail}>`
    : source.fromEmail;
  const body = source.bodyText ?? (source.bodyHtml ? htmlToText(source.bodyHtml) : "");
  return `\n\n---------- Forwarded message ----------\nFrom: ${fromDisplay}\nDate: ${formatFullDate(source.date)}\nSubject: ${source.subject}\nTo: ${source.to}\n\n${body}`;
}
