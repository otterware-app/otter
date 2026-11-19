import { useSyncExternalStore } from "react";
import { setSyncedPreference } from "../synced-preferences";

const AUTO_SETTLE_KEY = "assistant:auto-settle-days" as const;
export const AUTO_SETTLE_DEFAULT_DAYS = 7;
export const AUTO_SETTLE_MAX_DAYS = 90;
const listeners = new Set<() => void>();

/** How many quiet days settle a chat on its own, or null when none do (T3 Code's auto-settle). */
export function getAutoSettleDays(): number | null {
  const saved = localStorage.getItem(AUTO_SETTLE_KEY);
  if (saved === "off") return null;
  const days = Number(saved);
  return saved && Number.isInteger(days) && days >= 1 && days <= AUTO_SETTLE_MAX_DAYS
    ? days
    : AUTO_SETTLE_DEFAULT_DAYS;
}

export function setAutoSettleDays(days: number | null): void {
  setSyncedPreference(AUTO_SETTLE_KEY, days === null ? "off" : String(days));
  for (const listener of listeners) listener();
}

window.addEventListener("storage", (event) => {
  if (event.key === AUTO_SETTLE_KEY) for (const listener of listeners) listener();
});

export function useAutoSettleDays(): number | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getAutoSettleDays);
}
