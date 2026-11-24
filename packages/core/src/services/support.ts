import { supportError, type SupportDiagnostics } from "@otter/shared/support";
import { platform } from "../platform.ts";
import { isSignedIn } from "../providers/index.ts";
import { listAccounts } from "./account-store.ts";
import { getSyncStatus, turnedOffMailboxes } from "./mail-sync.ts";
import { errorReportsConfig } from "./error-reports.ts";
import { getSettings } from "./settings-store.ts";
import { recentSupportErrors } from "./support-errors.ts";

export async function collectSupportDiagnostics(): Promise<SupportDiagnostics> {
  const unavailable: string[] = [];
  const [accounts, settings, shell, reports] = await Promise.all([
    listAccounts().catch(() => {
      unavailable.push("Mailbox metadata");
      return [];
    }),
    getSettings().catch(() => {
      unavailable.push("Sync settings");
      return null;
    }),
    platform()
      .supportDiagnostics?.()
      .catch(() => {
        unavailable.push("Environment / recent errors");
        return null;
      }),
    errorReportsConfig().catch(() => null),
  ]);
  const off = turnedOffMailboxes();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: platform().appVersion,
    platform: platform().kind,
    environment: shell?.environment ?? platform().kind,
    syncIntervalSeconds: settings?.syncIntervalSeconds ?? null,
    reportId: reports?.enabled ? reports.reportId : null,
    mailboxes: accounts.map((account, index) => {
      let sync: SupportDiagnostics["mailboxes"][number]["sync"] = null;
      try {
        const state = getSyncStatus(account.id);
        sync = {
          syncing: state.syncing,
          phase: state.phase,
          synced: state.synced,
          total: state.total,
          lastSyncAt: state.lastSyncAt,
          fullSyncDone: state.fullSyncDone,
          error: state.error
            ? supportError(new Date().toISOString(), "mail-sync", state.error)!.category
            : null,
        };
      } catch {
        unavailable.push(`Mailbox ${index + 1} sync status`);
      }
      return {
        mailbox: `Mailbox ${index + 1}`,
        provider: account.provider ?? "gmail",
        enabled: !off.has(account.id),
        authenticated: isSignedIn(account),
        sync,
      };
    }),
    errors: shell?.errors ?? recentSupportErrors(),
    unavailable,
  };
}
