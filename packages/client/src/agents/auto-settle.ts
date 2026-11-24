import { useSyncExternalStore } from "react";
import {
  getSyncedPreference,
  onSyncedPreferenceChange,
  setSyncedPreference,
} from "../preferences.ts";

const AUTO_SETTLE_KEY = "assistant:auto-settle-days";
export const AUTO_SETTLE_DEFAULT_DAYS = 7;
export const AUTO_SETTLE_MAX_DAYS = 90;

/** How many quiet days settle a chat on its own, or null when none do (T3 Code's auto-settle). */
export function getAutoSettleDays(): number | null {
  const saved = getSyncedPreference(AUTO_SETTLE_KEY);
  if (saved === "off") return null;
  const days = Number(saved);
  return saved && Number.isInteger(days) && days >= 1 && days <= AUTO_SETTLE_MAX_DAYS
    ? days
    : AUTO_SETTLE_DEFAULT_DAYS;
}

export function setAutoSettleDays(days: number | null): void {
  setSyncedPreference(AUTO_SETTLE_KEY, days === null ? "off" : String(days));
}

const subscribe = (listener: () => void) =>
  onSyncedPreferenceChange((key) => key === AUTO_SETTLE_KEY && listener());

export function useAutoSettleDays(): number | null {
  return useSyncExternalStore(subscribe, getAutoSettleDays);
}
