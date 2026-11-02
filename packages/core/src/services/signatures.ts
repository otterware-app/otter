// Older Gmail grants lack gmail.settings.basic; keep signatures locally until the user grants it.

import { GMAIL_SETTINGS_PERMISSION } from "@otter-mail/contracts";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { findProvider, isSignedIn } from "../providers/index.js";
import { keepsSendAsOnDevice, listAccounts, updateAccount } from "./account-store.js";
import { preferenceChanged } from "./preferences.js";
import type { MailAccount } from "../types.js";

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
    // This sign-in may not change Gmail's settings: keep it here until one may.
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
    // Kept only here until now: move it to Gmail (if this sign-in may).
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
    if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(address)) {
      throw new Error(`${String(entry)} isn't an email address.`);
    }
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    addresses.push(address);
  }
  const updated = await updateAccount(account.id, { sendAs: addresses });
  preferenceChanged("sendAs");
  return updated;
}

/** The addresses the server lets it send from besides its own (Gmail's send-as). */
async function refreshSendAs(account: MailAccount): Promise<boolean> {
  const read = findProvider(account)?.sendAs;
  if (!read) return false;
  const addresses = await read(account.id, account.email);
  if ((account.sendAs ?? []).join() === addresses.join()) return false;
  await updateAccount(account.id, { sendAs: addresses });
  return true;
}

/** Refreshes each mailbox's signature and, alongside, the addresses it sends from. */
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
