import type { MessageDetail } from "../../state/mail";
import { splitAddresses } from "../thread/reader";

/** The composer's attachments total at most this (the Swift app's DraftFile.limit, core's send limit). */
export const ATTACHMENT_LIMIT = 25 * 1024 * 1024;

export const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text as the editor's HTML: escaped, its lines kept. */
export const plainHtml = (text: string) => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;

export const prefixed = (prefix: string, subject: string) =>
  new RegExp(`^${prefix}:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;

export function quoted(message: MessageDetail, intro: string): string {
  // Inline images stay with the original; the quote can't show them.
  const html = message.bodyHtml?.replace(/<img[^>]+src\s*=\s*["']?cid:[^>]*>/gi, "");
  const body = html ?? plainHtml(message.bodyText ?? message.snippet);
  return `<p><br></p>${plainHtml(intro)}<blockquote>${body}</blockquote>`;
}

export const emailOf = (entry: string) => (/<([^>]+)>/.exec(entry)?.[1] ?? entry).trim();

/**
 * the Swift app's Draft.reply: to the sender, or, answering your own message, to
 * whom it went; Reply all adds everyone else, never yourself.
 */
export function replyRecipients(
  message: Pick<MessageDetail, "fromName" | "fromEmail" | "to" | "cc">,
  mine: ReadonlySet<string>,
  all: boolean,
): { to: string[]; cc: string[] } {
  const isMine = (entry: string) => mine.has(emailOf(entry).toLowerCase());
  const sender = message.fromName
    ? `"${message.fromName.replace(/"/g, '\\"')}" <${message.fromEmail}>`
    : message.fromEmail;
  const fromMe = mine.has(message.fromEmail.toLowerCase());
  const to = fromMe ? splitAddresses(message.to) : [sender];
  if (!all) return { to, cc: [] };
  const seen = new Set(to.map((e) => emailOf(e).toLowerCase()));
  const others = [...splitAddresses(message.to), ...splitAddresses(message.cc ?? "")].filter(
    (e) => {
      const email = emailOf(e).toLowerCase();
      if (isMine(e) || seen.has(email)) return false;
      seen.add(email);
      return true;
    },
  );
  return fromMe ? { to: [...to, ...others], cc: [] } : { to, cc: others };
}

/** the Swift app's Draft.validRecipient: one address, something on each side of the @. */
export function validRecipient(token: string): boolean {
  const email = emailOf(token);
  const [local, domain, extra] = email.split("@");
  return Boolean(local) && Boolean(domain) && extra === undefined && !/[\s<>,;"]/.test(email);
}

export type Sender = { accountId: string; mailbox: string; address: string };

type SenderMailbox = { id: string; email: string; sendAs?: string[]; signedOut?: boolean };

/**
 * the Swift app's senders: a new message can come from any mailbox and its
 * aliases; a reply or a draft stays in its own mailbox.
 */
export function senders(
  mailboxes: readonly SenderMailbox[],
  accountId: string,
  anyMailbox: boolean,
): Sender[] {
  return mailboxes
    .filter((m) => !m.signedOut && (anyMailbox || m.id === accountId))
    .flatMap((m) =>
      [m.email, ...(m.sendAs ?? [])].map((address) => ({
        accountId: m.id,
        mailbox: m.email,
        address: address.toLowerCase(),
      })),
    );
}

/** The web's signatureFor: an alias mailbox's own signature, else the mailbox's. */
export function signatureFor(
  mailbox: { signature?: string; aliasMailboxes?: { address: string; signature?: string }[] },
  address: string | undefined,
): string | null {
  const alias = address
    ? mailbox.aliasMailboxes?.find((a) => a.address.toLowerCase() === address.toLowerCase())
    : undefined;
  return alias?.signature || mailbox.signature || null;
}

export const totalSize = (attachments: readonly { size: number }[]) =>
  attachments.reduce((sum, a) => sum + a.size, 0);
