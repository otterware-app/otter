import type { ThemeSource } from "@otter-mail/contracts";

const THEME_SOURCE = "otter:theme-source";

const SYNCED_KEYS = [
  THEME_SOURCE,
  // Before the picks: apply() goes in order, so a theme made elsewhere exists here before it's worn.
  "otter:themes:v1",
  "otter:theme:light",
  "otter:theme:dark",
  "otter:contrast",
  "otter:glass-opacity",
  "otter:interface-font-size",
  "otter:reading-width",
  "otter:group-messages-by-day",
  "otter:mail-layout",
  "otter:open-messages-with-arrows",
  "otter:mark-read-delay",
  "gmail:panel-animation-duration",
  "gmail:advance-direction",
  "assistant:favorite-models",
  "assistant:hidden-models",
  "assistant:follow-up-behavior",
  "mail:mailboxes",
  "otter:extensions:disabled",
] as const;

export type SyncedKey = (typeof SYNCED_KEYS)[number];

type UiPreferences = Partial<Record<string, string>>;

/** Keys set since startup: the startup snapshot, answered later, mustn't undo them. */
const settled = new Set<string>();

export function setSyncedPreference(key: SyncedKey, value: string): void {
  settled.add(key);
  localStorage.setItem(key, value);
  void window.desktopBridge.invoke("preferences:setUi", { key, value });
}

function apply(ui: UiPreferences, skip: ReadonlySet<string> = new Set()): void {
  for (const key of SYNCED_KEYS) {
    const value = ui[key];
    if (value === undefined || skip.has(key)) continue;
    settled.add(key);
    if (value === localStorage.getItem(key)) continue;
    localStorage.setItem(key, value);
    if (key === THEME_SOURCE)
      void window.desktopBridge.nativeTheme.setThemeSource(value as ThemeSource);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }
}

let initialPreferences: Promise<void> | undefined;

/** The browser awaits this before mounting, so its first render uses its saved palette. */
export function loadSyncedPreferences(initialize = false): Promise<void> {
  return (initialPreferences ??= window.desktopBridge
    .invoke<UiPreferences>("preferences:getUi", { initialize })
    .then((ui) => {
      const newer = new Set(settled);
      for (const key of SYNCED_KEYS) {
        const here = localStorage.getItem(key);
        if (ui[key] === undefined && here !== null && !newer.has(key))
          setSyncedPreference(key, here);
      }
      apply(ui, newer);
    }));
}

export function startSyncedPreferences(): () => void {
  void loadSyncedPreferences().catch((err) => console.warn("Couldn't load UI preferences", err));
  return window.desktopBridge.on("preferences:uiChanged", (ui) => apply(ui as UiPreferences));
}
