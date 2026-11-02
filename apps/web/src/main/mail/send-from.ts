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

/**
 * The address a composer sends from: the one picked (or the draft's), else `fallback`. A picked
 * address the mailbox no longer sends from (removed in Settings, maybe on another device) stays,
 * `unavailable`, so sending waits for another: never quietly swapped for a different sender.
 */
export function chosenAddress(
  account: MailAccount,
  picked: string | undefined,
  fallback: string,
): { address: string; unavailable: boolean } {
  if (!picked) return { address: fallback, unavailable: false };
  const own = ownAddress(account, picked);
  return { address: own ?? picked, unavailable: !own };
}
