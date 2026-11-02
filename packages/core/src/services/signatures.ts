// Older Gmail grants lack gmail.settings.basic; keep signatures locally until the user grants it.

import { GMAIL_SETTINGS_PERMISSION } from "@otter-mail/contracts";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { findProvider, isSignedIn } from "../providers/index.js";
import { listAccounts, updateAccount } from "./account-store.js";
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

export async function refreshSignatures(): Promise<void> {
  let changed = false;
  for (const account of await listAccounts()) {
    if (!isSignedIn(account)) continue;
    try {
      changed = (await refreshSignature(account)) || changed;
    } catch (err) {
      logger.info("signatures", `Couldn't read ${account.email}'s signature: ${String(err)}`);
    }
  }
  if (changed) broadcast("gmail:accounts-changed");
}
