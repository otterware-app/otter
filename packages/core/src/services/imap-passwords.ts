/**
 * IMAP passwords, one per mailbox, in the platform's secrets under
 * `imap-password:<accountId>`. Never synced: each device asks once. Kept in
 * memory too, so "is this mailbox signed in?" answers without waiting.
 */

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { listAccounts } from "./account-store.js";

const passwords = new Map<string, string>();

const secretName = (accountId: string) => `imap-password:${accountId}`;

export async function loadImapPasswords(): Promise<void> {
  passwords.clear();
  for (const account of await listAccounts()) {
    if (account.provider !== "imap") continue;
    const password = await platform()
      .secrets.get(secretName(account.id))
      .catch(() => null);
    if (password) passwords.set(account.id, password);
  }
}

export function getImapPassword(accountId: string): string | null {
  return passwords.get(accountId) ?? null;
}

export function hasImapPassword(accountId: string): boolean {
  return passwords.has(accountId);
}

export async function setImapPassword(accountId: string, password: string): Promise<void> {
  await platform().secrets.set(secretName(accountId), password);
  passwords.set(accountId, password);
}

export async function deleteImapPassword(accountId: string): Promise<void> {
  passwords.delete(accountId);
  await platform().secrets.delete(secretName(accountId));
}

/**
 * Stops using `password` until the user enters one again (gmail:signInImap):
 * the mailbox reads as signed out, so sync and IDLE stop and the UI asks for
 * it. For a password the server refused, whose retries would get the account
 * locked or the relay's addresses banned. The stored copy stays, so a refusal
 * that was the server's hiccup heals on the next launch (one more try).
 */
export function setAsideImapPassword(accountId: string, password: string, why: string): void {
  if (passwords.get(accountId) !== password) return;
  passwords.delete(accountId);
  logger.warn("imap", `Not using ${accountId}'s password until it's entered again: ${why}`);
  broadcast("gmail:accounts-changed");
}
