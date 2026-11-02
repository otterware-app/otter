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
/**
 * By mailbox: how many times it signed in again this session. An answer to a request made
 * before the latest sign-in is about the old one, and is dropped.
 */
const generations = new Map<string, number>();
/** By mailbox: the generation whose calendar access is known (refused or not). */
const known = new Map<string, number>();
/** By mailbox: the calendar check running or last failed (not for want of permission). */
const probes = new Map<string, { generation: number; promise: Promise<void>; failedAt?: number }>();
/** How long a check that failed for another reason (offline, rate limit) waits to retry. */
const RETRY_MS = 5 * 60_000;

/** Pass it to noteRefused / noteAllowed for an answer to a request made now. */
export function generationOf(accountId: string): number {
  return generations.get(accountId) ?? 0;
}

function current(accountId: string, generation: number): boolean {
  return generation === generationOf(accountId);
}

export function noteRefused(accountId: string, operation: Operation, generation: number): void {
  if (!current(accountId, generation)) return;
  known.set(accountId, generation);
  const ops = refused.get(accountId) ?? new Set<Operation>();
  if (ops.has(operation)) return;
  refused.set(accountId, ops.add(operation));
  broadcast("connections:changed");
}

export function noteAllowed(accountId: string, operation: Operation, generation: number): void {
  if (!current(accountId, generation)) return;
  known.set(accountId, generation);
  if (refused.get(accountId)?.delete(operation)) broadcast("connections:changed");
}

/** The mailbox signed in again: what it was refused may be allowed now. */
export function forgetRefusals(accountId: string): void {
  generations.set(accountId, generationOf(accountId) + 1);
  probes.delete(accountId);
  if (refused.delete(accountId)) broadcast("connections:changed");
}

/**
 * Asks the calendar whether it may list every calendar: once per sign-in, shared by whoever
 * asks while it runs; one that failed for another reason is retried after a while.
 */
function probeCalendar(account: MailAccount): Promise<void> {
  const calendar = findProvider(account)?.calendar;
  const generation = generationOf(account.id);
  if (!calendar || known.get(account.id) === generation) return Promise.resolve();
  const running = probes.get(account.id);
  if (
    running?.generation === generation &&
    (running.failedAt === undefined || Date.now() - running.failedAt < RETRY_MS)
  ) {
    return running.promise;
  }
  const probe: { generation: number; promise: Promise<void>; failedAt?: number } = {
    generation,
    promise: calendar.listCalendars(account.id).then(
      () => noteAllowed(account.id, "listCalendars", generation),
      (error: unknown) => {
        if (error instanceof NoCalendarAccess) {
          noteRefused(account.id, "listCalendars", generation);
          return;
        }
        probe.failedAt = Date.now();
        logger.info("connections", `Couldn't check ${account.email}'s calendar: ${String(error)}`);
      },
    ),
  };
  probes.set(account.id, probe);
  return probe.promise;
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
