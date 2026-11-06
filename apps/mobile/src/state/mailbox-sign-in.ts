import { mailboxes, type Mailbox } from "./client";
import { core } from "./core";

/** "Contoso is signed out", "Contoso needs its password". */
export function signedOutTitle(mailbox: Mailbox): string {
  const name = mailbox.displayName || mailbox.name || mailbox.email;
  return mailbox.provider === "imap" ? `${name} needs its password` : `${name} is signed out`;
}

/**
 * The Swift app's Session.signIn(mailbox:): Google or Microsoft again, as this
 * mailbox (the provider's sheet suggests it). Another account chosen is
 * refused, and dropped if it wasn't here before. False when cancelled.
 */
export async function signInAgain(mailbox: Mailbox): Promise<boolean> {
  const before = new Set(
    (await core.invoke<{ email: string }[]>("gmail:listAccounts")).map((a) => a.email),
  );
  const channel = mailbox.provider === "outlook" ? "gmail:addOutlookAccount" : "gmail:addAccount";
  const added = await core.invoke<{ id: string; email: string } | null>(channel, {
    email: mailbox.email,
  });
  await mailboxes.refreshAccounts();
  if (!added) return false;
  if (added.email.toLowerCase() !== mailbox.email.toLowerCase()) {
    if (!before.has(added.email)) {
      await core.invoke("gmail:removeAccount", { accountId: added.id }).catch(() => {});
      await mailboxes.refreshAccounts();
    }
    throw new Error(`That's ${added.email}. Sign in as ${mailbox.email}.`);
  }
  return true;
}

export async function signInWithPassword(mailbox: Mailbox, password: string): Promise<void> {
  await core.invoke("gmail:signInImap", { accountId: mailbox.id, password });
  await mailboxes.refreshAccounts();
}

/** Errors a sign-in sheet reports when it's closed: no alert for those. */
export const cancelled = (error: unknown) =>
  /cancel/i.test(error instanceof Error ? error.message : String(error));
