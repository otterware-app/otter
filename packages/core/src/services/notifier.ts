/**
 * notifier.ts
 *
 * New-mail notifications and the unread badge (the Dock, or the browser tab).
 *
 * Notifications fire only for messages newly added by an incremental sync's
 * history feed (mail-sync calls notifyNewMail with them) — never for full
 * syncs, body backfills, or an account's first sync. The badge mirrors
 * total INBOX unread across the mailboxes that are on, after syncs, local
 * mutations, and turning a mailbox on or off.
 *
 * A sign-in code in the mail is shown in the notification, and on the Mac
 * offered to copy (its Copy & trash button: the mail goes once the code is used).
 */

import { aliasMailboxName, validAliasMailboxes } from "@otter/contracts";

import { findVerificationCode, mentionsVerificationCode } from "@otter/shared/verification-code";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { providerFor } from "../providers/index.js";
import { getAccount, listAccounts } from "./account-store.js";
import { aliasMailboxFor } from "./alias-mailboxes.js";
import { turnedOffMailboxes } from "./mail-sync.js";
import { getSettings } from "./settings-store.js";
import * as mailStore from "./mail-store.js";
import { bodyText } from "./agent/tools/text.js";
import type { MailAccount, MessageSummary } from "../types.js";

const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

export function accountLabel(account: MailAccount): string {
  return account.displayName?.trim() || account.name || account.email;
}

/** Message-IDs notified lately: copies of one message arrive seconds apart, maybe in two syncs. */
const notified = new Map<string, number>();
const NOTIFIED_MS = 15 * 60_000;

export function firstCopy(accountId: string, m: MessageSummary, now = Date.now()): boolean {
  for (const [key, at] of notified) if (now - at > NOTIFIED_MS) notified.delete(key);
  if (!m.messageIdHeader) return true;
  const key = `${accountId}:${m.messageIdHeader}`;
  if (notified.has(key)) return false;
  notified.set(key, now);
  return true;
}

async function codeIn(accountId: string, m: MessageSummary): Promise<string | undefined> {
  let detail = mailStore.getMessageDetail(accountId, m.id);
  if (!detail && mentionsVerificationCode(`${m.subject}\n${m.snippet}`)) {
    detail = await providerFor(accountId)
      .getMessage(accountId, m.id)
      .catch(() => null);
    if (detail) mailStore.upsertMessageDetail(accountId, detail);
  }
  return findVerificationCode(m.subject, detail ? bodyText(detail) : m.snippet) ?? undefined;
}

/**
 * Notify about messages an incremental sync just stored. Filters by the
 * notifications setting, drops anything older than the account's previous
 * completed sync, and never notifies for the account's own outgoing mail.
 */
export async function notifyNewMail(
  accountId: string,
  added: MessageSummary[],
  prevLastSyncAt: number | null,
): Promise<void> {
  try {
    if (added.length === 0) return;
    const settings = await getSettings();
    if (settings.notificationsMode === "off") return;
    const account = await getAccount(accountId);
    if (!account) return;

    const own = new Set([account.email, ...(account.sendAs ?? [])].map((a) => a.toLowerCase()));
    const cutoff = prevLastSyncAt ?? 0;
    const fresh = added.filter(
      (m) =>
        m.date > cutoff &&
        m.unread &&
        !own.has(m.fromEmail.toLowerCase()) &&
        (settings.notificationsMode === "all" || m.labelIds.includes("INBOX")) &&
        firstCopy(accountId, m),
    );
    if (fresh.length === 0) return;

    const off = turnedOffMailboxes();
    const aliases = validAliasMailboxes(
      account,
      (await listAccounts()).map((a) => a.email),
    ).filter((alias) => !off.has(alias.address.toLowerCase()));
    const mailbox = accountLabel(account);
    if (fresh.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
      for (const m of fresh) {
        const about = m.subject || m.snippet;
        const code = await codeIn(accountId, m);
        const alias = aliasMailboxFor(aliases, m);
        platform().notify({
          category: "mail",
          title: `Mail · ${alias ? aliasMailboxName(alias) : mailbox}`,
          subtitle: m.fromName || m.fromEmail,
          // The code in the text too, for notifications without buttons (Linux, browsers).
          body: code && !about.includes(code) ? `${about}\nCode: ${code}` : about,
          open: {
            accountId,
            messageId: m.id,
            ...(alias ? { mailbox: alias.address.toLowerCase() } : {}),
          },
          code,
        });
      }
    } else {
      const newest = fresh.reduce((a, b) => (b.date > a.date ? b : a));
      platform().notify({
        category: "mail",
        title: `Mail · ${mailbox}`,
        body: `${fresh.length} new messages`,
        open: { accountId, messageId: newest.id },
      });
    }
  } catch (err) {
    logger.failure("notifier", "notifyNewMail failed", err);
  }
}

export function updateDockBadge(): void {
  try {
    platform().setUnreadCount(mailStore.countInboxUnreadAll(turnedOffMailboxes()));
  } catch (err) {
    logger.failure("notifier", "badge update failed", err);
  }
}
