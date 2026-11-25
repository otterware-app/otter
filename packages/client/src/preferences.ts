import { ipc, listen } from "./bridge.ts";
import { host } from "./host.ts";

const SYNCED_KEYS = [
  "otter:theme-source",
  // Before the picks: apply() goes in order, so a theme made elsewhere exists here before it's worn.
  "otter:themes:v1",
  "otter:theme:light",
  "otter:theme:dark",
  "otter:contrast",
  "otter:glass-opacity",
  "otter:interface-font-size",
  "otter:reading-width",
  "otter:group-messages-by-day",
  "otter:full-width-rows",
  "otter:mail-layout",
  "otter:open-messages-with-arrows",
  "otter:mark-read-delay",
  "gmail:panel-animation-duration",
  "gmail:advance-direction",
  "assistant:favorite-models",
  "assistant:hidden-models",
  "assistant:follow-up-behavior",
  "assistant:auto-settle-days",
  "mail:mailboxes",
  "mail:alias-mail-apart",
  "mail:sidebar",
  "otter:extensions:disabled",
  "calendar:week-start",
  "calendar:show-weekends",
  "calendar:show-declined",
  "calendar:time-format",
  "calendar:meetings-by-default",
  "calendar:default-calendar",
  "calendar:colors",
  "browser:solve-captchas",
] as const;

/** A preference that follows the Otter account to each device (core's `preferences:*`). */
export type SyncedKey = (typeof SYNCED_KEYS)[number];

type UiPreferences = Partial<Record<string, string>>;

const isSynced = (key: string): key is SyncedKey =>
  (SYNCED_KEYS as readonly string[]).includes(key);

/** Keys set since startup: the startup snapshot, answered later, mustn't undo them. */
const settled = new Set<string>();
const changes = new Set<(key: SyncedKey) => void>();
const arrivals = new Set<(key: SyncedKey, value: string) => void>();

export function getSyncedPreference(key: SyncedKey): string | null {
  return host().storage.get(key);
}

export function setSyncedPreference(key: SyncedKey, value: string): void {
  save(key, value);
  for (const listener of changes) listener(key);
}

function save(key: SyncedKey, value: string): void {
  settled.add(key);
  host().storage.set(key, value);
  void ipc("preferences:setUi", { key, value });
}

/** Hears a synced preference change: set here, in another window, or on another device. */
export function onSyncedPreferenceChange(listener: (key: SyncedKey) => void): () => void {
  changes.add(listener);
  return () => changes.delete(listener);
}

/** Hears another device's choice, or the startup snapshot's, once it's stored here. */
export function onSyncedPreferenceArrival(
  listener: (key: SyncedKey, value: string) => void,
): () => void {
  arrivals.add(listener);
  return () => arrivals.delete(listener);
}

/** A host whose windows share its storage tells the client of another window's change. */
export function syncedPreferenceChanged(key: string): void {
  if (!isSynced(key)) return;
  for (const listener of changes) listener(key);
}

function apply(ui: UiPreferences, skip: ReadonlySet<string> = new Set()): void {
  for (const key of SYNCED_KEYS) {
    const value = ui[key];
    if (value === undefined || skip.has(key)) continue;
    settled.add(key);
    if (value === host().storage.get(key)) continue;
    host().storage.set(key, value);
    for (const listener of arrivals) listener(key, value);
    for (const listener of changes) listener(key);
  }
}

let initialPreferences: Promise<void> | undefined;

/** A browser awaits this before it renders, so its first render wears the saved palette. */
export function loadSyncedPreferences(initialize = false): Promise<void> {
  return (initialPreferences ??= ipc<UiPreferences>("preferences:getUi", { initialize }).then(
    (ui) => {
      const newer = new Set(settled);
      for (const key of SYNCED_KEYS) {
        const here = host().storage.get(key);
        if (ui[key] === undefined && here !== null && !newer.has(key)) save(key, here);
      }
      apply(ui, newer);
    },
  ));
}

export function startSyncedPreferences(): () => void {
  void loadSyncedPreferences().catch((err) => console.warn("Couldn't load UI preferences", err));
  return listen("preferences:uiChanged", (ui) => apply(ui as UiPreferences));
}
