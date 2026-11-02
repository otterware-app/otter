import { GMAIL_CAPABILITIES, type MailCapabilities } from "@otter-mail/contracts";
import { useAccounts } from "./hooks";
import type { MailAccount } from "./types";

/**
 * What a mailbox can do (Gmail's categories, several labels per message, …).
 * The UI hides what a mailbox can't do from these, the way it gates Mac-only
 * UI on `features`, and never from the provider itself. Accounts listed
 * before capabilities existed are Gmail.
 */
export function capabilitiesOf(account: MailAccount | null | undefined): MailCapabilities {
  return account?.capabilities ?? GMAIL_CAPABILITIES;
}

export function useCapabilities(accountId: string | null | undefined): MailCapabilities {
  const accounts = useAccounts().data;
  return capabilitiesOf(accounts?.find((a) => a.id === accountId));
}

/** Signs in with a password on each device (IMAP) rather than with Google or Microsoft. */
export function signsInWithPassword(account: MailAccount): boolean {
  return account.imap != null;
}

export function signInProvider(account: MailAccount): "gmail" | "outlook" {
  return account.provider === "outlook" ? "outlook" : "gmail";
}

export function signInName(account: MailAccount): string {
  return signInProvider(account) === "outlook" ? "Microsoft" : "Google";
}

export function mailServerName(account: MailAccount): string {
  if (account.imap) return account.imap.imap.host;
  return account.provider === "outlook" ? "Outlook" : "Gmail";
}
