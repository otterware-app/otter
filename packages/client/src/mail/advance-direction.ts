import { getSyncedPreference, setSyncedPreference } from "../preferences.ts";

export type AdvanceDirection = "next" | "previous" | "none";

const KEY = "gmail:advance-direction" as const;

export function getAdvanceDirection(): AdvanceDirection {
  const value = getSyncedPreference(KEY);
  return value === "previous" || value === "none" ? value : "next";
}

export function setAdvanceDirection(direction: AdvanceDirection): void {
  setSyncedPreference(KEY, direction);
}

export function pickAdvanceTarget<T>(rows: T[], idx: number): T | null {
  const direction = getAdvanceDirection();
  if (direction === "none") return null;
  if (direction === "previous") return rows[idx - 1] ?? rows[idx + 1] ?? null;
  return rows[idx + 1] ?? rows[idx - 1] ?? null;
}
