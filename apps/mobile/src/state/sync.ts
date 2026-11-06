import { useEffect } from "react";
import { AppState } from "react-native";

import { mailboxes, threadLists } from "./client";
import { core } from "./core";

type SyncStatus = { syncing: boolean; revision: number; download: unknown };

/**
 * Follows a mailbox's sync as the web app's useAccountSync does: polls core's
 * sync status (faster while it syncs) and reloads the lists and labels when
 * its revision moves, while the app is in front.
 */
export function useAccountSync(accountId: string | null): void {
  useEffect(() => {
    if (!accountId) return;
    let seen: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const poll = async () => {
      let status: SyncStatus | null = null;
      try {
        status = await core.invoke<SyncStatus>("gmail:getSyncStatus", { accountId });
        if (seen !== null && status.revision !== seen) {
          threadLists.invalidate(accountId);
          void mailboxes.refreshLabels(accountId);
        }
        seen = status.revision;
      } catch {
        // core restarting: the next poll asks again
      }
      if (stopped) return;
      const ms = status?.syncing ? 1500 : status?.download ? 4000 : 10_000;
      timer = setTimeout(() => {
        if (AppState.currentState === "active") void poll();
        else timer = setTimeout(() => void poll(), ms);
      }, ms);
    };
    void core.invoke("gmail:syncAccount", { accountId }).catch(() => {});
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [accountId]);
}
