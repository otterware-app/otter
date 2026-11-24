// Older Gmail grants lack gmail.settings.basic; keep signatures locally until the user grants it.

import { GMAIL_SETTINGS_PERMISSION } from "@otter/contracts";

import { broadcast } from "../ipc.ts";
import { logger } from "../logger.ts";
import { findProvider, isSignedIn } from "../providers/index.ts";
import { isSingleAddress } from "./outgoing.ts";
import { keepsSendAsOnDevice, listAccounts, updateAccount } from "./account-store.ts";
import { parseAliasMailboxes } from "./alias-mailboxes.ts";
import { validAliasMailboxes } from "@otter/contracts";
import { preferenceChanged } from "./preferences.ts";
import type { MailAccount } from "../types.ts";

export async function saveSignature(account: MailAccount, html: string): Promise<MailAccount> {
  const signatures = findProvider(account)?.signatures;
  if (!signatures) {
    const updated = await updateAccount(account.id, { signature: html });
    preferenceChanged("signatures");
    return updated;
  }
  try {
    const saved = await signatures.set(account.id, account.email, html);
    return updateAccount(account.id, { signature: saved, signatureInGmail: true });
  } catch (err) {
    if (!(err instanceof Error && err.message === GMAIL_SETTINGS_PERMISSION)) throw err;
    return updateAccount(account.id, { signature: html, signatureInGmail: false });
  }
}

async function refreshSignature(account: MailAccount): Promise<boolean> {
  const signatures = findProvider(account)?.signatures;
  if (!signatures) return false;
  if (account.signatureInGmail === false) {
    return (await saveSignature(account, account.signature ?? "")).signatureInGmail === true;
  }
  const inGmail = await signatures.get(account.id, account.email);
  if (!account.signatureInGmail && !inGmail && account.signature) {
    await saveSignature(account, account.signature).catch((err: unknown) =>
      logger.info(
        "signatures",
        `Couldn't move ${account.email}'s signature to Gmail: ${String(err)}`,
      ),
    );
    return true;
  }
  if (account.signatureInGmail && (account.signature ?? "") === inGmail) return false;
  await updateAccount(account.id, { signature: inGmail, signatureInGmail: true });
  return true;
}

/**
 * The addresses an IMAP mailbox sends from besides its own, as entered in Settings: trimmed,
 * once each, never its own. The server must accept them (iCloud+ custom domains, aliases).
 */
export async function saveSendAs(account: MailAccount, entered: unknown[]): Promise<MailAccount> {
  if (!keepsSendAsOnDevice(account))
    throw new Error(`${account.email}'s addresses come from its server.`);
  const seen = new Set([account.email.toLowerCase()]);
  const addresses: string[] = [];
  for (const entry of entered) {
    const address = typeof entry === "string" ? entry.trim() : "";
    // One bare address, as it goes in the From header and the SMTP envelope: no delimiters.
    if (!isSingleAddress(address)) {
      throw new Error(`${String(entry)} isn't an email address.`);
    }
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
  }
  // An address it no longer sends from is no longer a mailbox of its own.
  const kept = new Set(addresses.map((a) => a.toLowerCase()));
  const aliases = account.aliasMailboxes ?? [];
  const aliasMailboxes = aliases.filter((alias) => kept.has(alias.address.toLowerCase()));
  const updated = await updateAccount(account.id, { sendAs: addresses, aliasMailboxes });
  preferenceChanged("sendAs");
  if (aliasMailboxes.length !== aliases.length) preferenceChanged("aliasMailboxes");
  return updated;
}

export async function saveAliasMailboxes(
  account: MailAccount,
  entered: unknown,
): Promise<MailAccount> {
  if (!keepsSendAsOnDevice(account))
    throw new Error(`${account.email}'s addresses can't be mailboxes of their own.`);
  // A stale entry (maybe from another device) is dropped, not refused: it would block every edit.
  const mailboxes = (await listAccounts()).map((a) => a.email);
  const aliasMailboxes = validAliasMailboxes(
    { ...account, aliasMailboxes: parseAliasMailboxes(entered) },
    mailboxes,
  ).map((alias) => ({
    ...alias,
    address: account.sendAs!.find((a) => a.toLowerCase() === alias.address.toLowerCase())!,
  }));
  const updated = await updateAccount(account.id, { aliasMailboxes });
  preferenceChanged("aliasMailboxes");
  return updated;
}

async function refreshSendAs(account: MailAccount): Promise<boolean> {
  const read = findProvider(account)?.sendAs;
  if (!read) return false;
  const addresses = await read(account.id, account.email);
  if ((account.sendAs ?? []).join() === addresses.join()) return false;
  await updateAccount(account.id, { sendAs: addresses });
  return true;
}

export async function refreshSignatures(): Promise<void> {
  let changed = false;
  for (const account of await listAccounts()) {
    if (!isSignedIn(account)) continue;
    try {
      changed = (await refreshSignature(account)) || changed;
    } catch (err) {
      logger.info("signatures", `Couldn't read ${account.email}'s signature: ${String(err)}`);
    }
    try {
      changed = (await refreshSendAs(account)) || changed;
    } catch (err) {
      logger.info("signatures", `Couldn't read ${account.email}'s addresses: ${String(err)}`);
    }
  }
  if (changed) broadcast("gmail:accounts-changed");
}
