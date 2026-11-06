import { GMAIL_CAPABILITIES, type MailCapabilities } from "@otter-mail/contracts";
import type { MailboxInfo as MailAccount } from "./mail.ts";

/**
 * What a mailbox can do (Gmail's categories, several labels per message, …).
 * The UI hides what a mailbox can't do from these, the way it gates Mac-only
 * UI on `features`, and never from the provider itself. Accounts listed
 * before capabilities existed are Gmail.
 */
export function capabilitiesOf(account: MailAccount | null | undefined): MailCapabilities {
  return account?.capabilities ?? GMAIL_CAPABILITIES;
}

export function signsInWithPassword(account: MailAccount): boolean {
  return account.imap != null;
}

export function signInProvider(account: MailAccount): "gmail" | "outlook" {
  return account.provider === "outlook" ? "outlook" : "gmail";
}

export function signInName(account: MailAccount): string {
  return signInProvider(account) === "outlook" ? "Microsoft" : "Google";
}

/** On Apple's mail server, as Add mailbox › iCloud sets it up. */
export function isICloud(account: Pick<MailAccount, "imap">): boolean {
  return account.imap?.imap.host.toLowerCase() === "imap.mail.me.com";
}

export function mailServerName(account: MailAccount): string {
  if (isICloud(account)) return "iCloud";
  if (account.imap) return account.imap.imap.host;
  return account.provider === "outlook" ? "Outlook" : "Gmail";
}
