import { parseAddressEntry, splitAddressList } from "./address";
import type { MailAccount } from "./types";

/** Every address a mailbox sends from: its own first, then its others (`sendAs`). */
export function addressesOf(account: MailAccount): string[] {
  return [account.email, ...(account.sendAs ?? [])];
}

/** `address` as the mailbox spells it, when it's one of the mailbox's; else undefined. */
export function ownAddress(account: MailAccount, address: string | undefined): string | undefined {
  const wanted = address?.trim().toLowerCase();
  return wanted ? addressesOf(account).find((a) => a.toLowerCase() === wanted) : undefined;
}

/**
 * The address a reply goes out from, as Apple Mail picks it: the mailbox's own message keeps
 * the address it was sent from; otherwise whichever of its addresses the mail was sent to (To,
 * then Cc); else its own.
 */
export function replyAddress(
  account: MailAccount,
  message: { fromEmail: string; to: string; cc?: string },
): string {
  const recipients = [...splitAddressList(message.to), ...splitAddressList(message.cc ?? "")];
  return (
    ownAddress(account, message.fromEmail) ??
    recipients.map((entry) => ownAddress(account, parseAddressEntry(entry).email)).find(Boolean) ??
    account.email
  );
}
