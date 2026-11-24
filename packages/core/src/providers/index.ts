/**
 * Which provider an account's mail comes from: `account.provider`, absent
 * meaning Gmail (accounts stored before IMAP).
 */

import type { MailCapabilities, MailProviderKind } from "@otter/contracts";

import { imapHostOf, providerKindOf } from "../services/account-store.ts";
import type { MailAccount } from "../types.ts";
import { gmailProvider } from "./gmail/index.ts";
import { imapProvider } from "./imap/index.ts";
import { outlookProvider } from "./outlook/index.ts";
import type { MailProvider } from "./provider.ts";

const providers: Record<MailProviderKind, MailProvider | null> = {
  gmail: gmailProvider,
  imap: imapProvider,
  outlook: outlookProvider,
};

const UNAVAILABLE = "This kind of mailbox isn't available in this app.";

/** The account's provider; null when this build can't reach its kind of mailbox yet. */
export function findProvider(account: MailAccount | string): MailProvider | null {
  return providers[
    typeof account === "string" ? providerKindOf(account) : (account.provider ?? "gmail")
  ];
}

export function providerFor(account: MailAccount | string): MailProvider {
  const provider = findProvider(account);
  if (!provider) throw new Error(UNAVAILABLE);
  return provider;
}

const GMAIL_IMAP_HOSTS = new Set(["imap.gmail.com", "imap.googlemail.com"]);

export function capabilitiesOf(account: MailAccount | string): MailCapabilities | null {
  const capabilities = findProvider(account)?.capabilities ?? null;
  const host = typeof account === "string" ? imapHostOf(account) : account.imap?.imap.host;
  return capabilities && host && GMAIL_IMAP_HOSTS.has(host.toLowerCase())
    ? { ...capabilities, archiveFolder: false, stars: true }
    : capabilities;
}

export function isSignedIn(account: MailAccount | string): boolean {
  return (
    findProvider(account)?.isSignedIn(typeof account === "string" ? account : account.id) ?? false
  );
}

/** Why it can't, for the status line. */
export function signedOutMessage(account: MailAccount | string): string {
  return findProvider(account)?.signedOutMessage ?? UNAVAILABLE;
}
