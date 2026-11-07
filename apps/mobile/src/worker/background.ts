import {
  handle,
  logger,
  turnedOffMailboxes,
  type MailAccount,
  type SyncStatus,
} from "@otter-mail/core";

import { call } from "./call";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `background:refresh`: iOS woke the app (BGAppRefresh). Mailboxes that have
 * synced before catch up incrementally (Gmail's history, IMAP's and Graph's
 * changes since the last sync); one never synced waits for the app to open,
 * as its first sync would outlast the time iOS gives. Answers within
 * `budgetMs`, whether or not every sync finished.
 */
export function registerBackgroundHandlers(): void {
  handle("background:refresh", async (params) => {
    const budgetMs = (params as { budgetMs?: number } | undefined)?.budgetMs ?? 25_000;
    const startedAt = Date.now();
    const deadline = startedAt + budgetMs;
    const off = turnedOffMailboxes();
    const accounts = (await call<MailAccount[]>("gmail:listAccounts")).filter(
      (a) => !a.signedOut && !off.has(a.id),
    );
    const statuses = await Promise.all(
      accounts.map((a) => call<SyncStatus>("gmail:getSyncStatus", { accountId: a.id })),
    );
    const due = accounts.filter((_, i) => statuses[i]!.lastSyncAt !== null).map((a) => a.id);
    for (const accountId of due) await call("gmail:syncAccount", { accountId });

    let pending = due;
    while (pending.length && Date.now() < deadline) {
      await sleep(250);
      const now = await Promise.all(
        pending.map((accountId) => call<SyncStatus>("gmail:getSyncStatus", { accountId })),
      );
      pending = pending.filter((_, i) => now[i]!.syncing);
    }
    const result = {
      synced: due.length - pending.length,
      skipped: accounts.length - due.length,
      unfinished: pending.length,
      ms: Date.now() - startedAt,
    };
    logger.info("background", `refresh ${JSON.stringify(result)}`);
    return result;
  });
}
