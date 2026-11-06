import { useEffect, useState } from "react";
import { AppState } from "react-native";

import type { Mailbox } from "./client";
import { core } from "./core";

/** What core's `gmail:getSyncStatus` tells the health line and banners. */
export type SyncHealth = {
  syncing: boolean;
  lastSyncAt: number | null;
  error: string | null;
  signInNeeded: boolean;
};

/** The Swift app's `.relative(presentation: .named)`, in English. */
export function namedRelative(ms: number, now = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 60) return minutes <= 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "last week" : `${weeks} weeks ago`;
}

/** SyncStatusLine: the failure (with a dot) until it works again, else when it last synced. */
export function syncLine(
  health: SyncHealth | undefined,
  now = Date.now(),
): { text: string; warning: boolean } {
  if (health?.error && !health.syncing) {
    return { text: `${health.error} — will retry`, warning: true };
  }
  if (!health?.lastSyncAt) return { text: "Syncing…", warning: false };
  return {
    text:
      now - health.lastSyncAt < 60_000
        ? "Synced just now"
        : `Synced ${namedRelative(health.lastSyncAt, now)}`,
    warning: false,
  };
}

/**
 * The Swift app's lostSignIn: a mailbox that synced here and then lost its sign-in
 * (revoked, or the server refused the password). One added on another device
 * and never signed in here isn't lost; its Settings page asks instead.
 */
export const lostSignIn = (mailbox: Mailbox, health: SyncHealth | undefined) =>
  (mailbox.signedOut === true || health?.signInNeeded === true) && Boolean(health?.lastSyncAt);

/** Each mailbox's health, asked again every 5 seconds while the app is in front. */
export function useSyncHealth(accountIds: readonly string[]): Record<string, SyncHealth> {
  const [health, setHealth] = useState<Record<string, SyncHealth>>({});
  const key = accountIds.join("\n");
  useEffect(() => {
    if (!key) return;
    const ids = key.split("\n");
    let stopped = false;
    const poll = async () => {
      if (AppState.currentState !== "active") return;
      const entries = await Promise.all(
        ids.map((accountId) =>
          core.invoke<SyncHealth>("gmail:getSyncStatus", { accountId }).then(
            (status) => [accountId, status] as const,
            () => null,
          ),
        ),
      );
      if (!stopped) setHealth(Object.fromEntries(entries.filter((e) => e !== null)));
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key]);
  return health;
}

export const syncNow = (accountId: string) =>
  core.invoke("gmail:syncAccount", { accountId }).catch(() => {});
