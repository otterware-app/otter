import { useSyncExternalStore } from "react";
import {
  getSyncedPreference,
  onSyncedPreferenceChange,
  setSyncedPreference,
  type SyncedKey,
} from "../preferences.ts";
import type { AgentId } from "./api.ts";

/** The models starred in the model picker, and those hidden from it, across the account's devices. */
type Prefs = { favorites: string[]; hidden: string[] };

const KEYS = {
  favorites: "assistant:favorite-models",
  hidden: "assistant:hidden-models",
} as const satisfies Record<keyof Prefs, SyncedKey>;

const listeners = new Set<() => void>();

function read(key: SyncedKey): string[] {
  try {
    const parsed = JSON.parse(getSyncedPreference(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

let snapshot: Prefs | null = null;

const current = (): Prefs =>
  (snapshot ??= { favorites: read(KEYS.favorites), hidden: read(KEYS.hidden) });

function write(name: keyof Prefs, values: string[]): void {
  setSyncedPreference(KEYS[name], JSON.stringify(values));
}

onSyncedPreferenceChange((key) => {
  if (key !== KEYS.favorites && key !== KEYS.hidden) return;
  snapshot = null;
  for (const listener of listeners) listener();
});

export const modelKey = (agent: AgentId, slug: string) => `${agent}:${slug}`;

export function useModelPrefs(): Prefs {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}

export function toggleFavorite(key: string): void {
  const { favorites } = current();
  write(
    "favorites",
    favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key],
  );
}

export function setHidden(key: string, hidden: boolean): void {
  const rest = current().hidden.filter((k) => k !== key);
  write("hidden", hidden ? [...rest, key] : rest);
}

export function toggleAllHidden(keys: string[]): void {
  const { hidden } = current();
  const allHidden = keys.every((k) => hidden.includes(k));
  write(
    "hidden",
    allHidden ? hidden.filter((k) => !keys.includes(k)) : [...new Set([...hidden, ...keys])],
  );
}

export function resetModelPrefs(agent: AgentId): void {
  const prefix = `${agent}:`;
  write(
    "favorites",
    current().favorites.filter((key) => !key.startsWith(prefix)),
  );
  write(
    "hidden",
    current().hidden.filter((key) => !key.startsWith(prefix)),
  );
}
