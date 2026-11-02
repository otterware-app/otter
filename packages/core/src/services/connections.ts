/**
 * Connections (docs/connections.md): each sign-in to an outside service and what it provides,
 * derived from the mailboxes and their providers. What needs permission is learned from the
 * provider refusing an operation, kept in memory, and forgotten when the mailbox signs in again
 * or the operation works: never stored, so nothing about stored mailboxes changes.
 */

import type { AccessNeed, ConnectionSummary } from "@otter-mail/contracts";

import { broadcast } from "../ipc.js";
import { logger } from "../logger.js";
import { capabilitiesOf, findProvider, isSignedIn } from "../providers/index.js";
import { NoCalendarAccess } from "../providers/provider.js";
import type { MailAccount } from "../types.js";
import { listAccounts } from "./account-store.js";

type Operation = AccessNeed["operation"];

const COPY: Record<Operation, Omit<AccessNeed, "operation">> = {
  listCalendars: {
    consequence: "Only your main calendar is showing",
    allow: "Allow calendar access",
  },
  saveSignature: {
    consequence: "Your signature is saved in Otter Mail, not in Gmail",
    allow: "Allow saving to Gmail",
  },
};

const need = (operation: Operation): AccessNeed => ({ operation, ...COPY[operation] });

/** By mailbox: the operations its provider refused for want of permission. */
const refused = new Map<string, Set<Operation>>();
/** Mailboxes whose calendar access is known this session (refused or not). */
const probed = new Set<string>();

export function noteRefused(accountId: string, operation: Operation): void {
  probed.add(accountId);
  const ops = refused.get(accountId) ?? new Set<Operation>();
  if (ops.has(operation)) return;
  refused.set(accountId, ops.add(operation));
  broadcast("connections:changed");
}

export function noteAllowed(accountId: string, operation: Operation): void {
  probed.add(accountId);
  if (refused.get(accountId)?.delete(operation)) broadcast("connections:changed");
}

/** The mailbox signed in again: what it was refused may be allowed now. */
export function forgetRefusals(accountId: string): void {
  probed.delete(accountId);
  if (refused.delete(accountId)) broadcast("connections:changed");
}

/** Asks the calendar once a session whether it may list every calendar. */
async function probeCalendar(account: MailAccount): Promise<void> {
  const calendar = findProvider(account)?.calendar;
  if (!calendar || probed.has(account.id)) return;
  try {
    await calendar.listCalendars(account.id);
    noteAllowed(account.id, "listCalendars");
  } catch (error) {
    if (error instanceof NoCalendarAccess) noteRefused(account.id, "listCalendars");
    else logger.info("connections", `Couldn't check ${account.email}'s calendar: ${String(error)}`);
  }
}

const PROVIDERS = { gmail: "google", outlook: "microsoft", imap: "imap" } as const;

export async function listConnections(): Promise<ConnectionSummary[]> {
  const accounts = await listAccounts();
  await Promise.all(
    accounts
      .filter((a) => isSignedIn(a) && capabilitiesOf(a)?.calendar)
      .map((a) => probeCalendar(a)),
  );
  return accounts.map((account) => {
    const ops = refused.get(account.id) ?? new Set<Operation>();
    // Saved only here because this sign-in may not change Gmail's settings (services/signatures.ts).
    const mailNeeds = account.signatureInGmail === false ? [need("saveSignature")] : [];
    return {
      id: account.id,
      provider: PROVIDERS[account.provider ?? "gmail"],
      label: account.email,
      signedIn: isSignedIn(account),
      resources: [
        { kind: "mail", needs: mailNeeds },
        ...(capabilitiesOf(account)?.calendar
          ? [
              {
                kind: "calendar" as const,
                needs: ops.has("listCalendars") ? [need("listCalendars")] : [],
              },
            ]
          : []),
      ],
    };
  });
}
