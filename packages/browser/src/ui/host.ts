import type { ComponentType } from "react";

export type FindBarProps = {
  label: string;
  focusKey: number;
  query: string;
  onQuery: (query: string) => void;
  /** The match shown, from 0; -1 for none. */
  at: number;
  total: number;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
};

export type BrowserSettingId =
  | "browser-extensions"
  | "browser-extensions-button"
  | "browser-import";

/** What the browser's screens ask of the app that shows them, set once at startup. */
export type BrowserUIHost = {
  /** Whether this app can show pages (a shell with `<webview>`). */
  enabled: boolean;
  /** "macOS", "Linux": named where the system asks the user something. */
  systemName: string;
  openSettings(): void;
  /** A shortcut as this OS writes it: "mod+[" → ⌘[ or Ctrl+[. */
  shortcutText(keys: string): string;
  FindBar: ComponentType<FindBarProps>;
  isFindKey(event: KeyboardEvent): boolean;
  /** Props that let the app's Settings search find and scroll to a setting. */
  settingProps(id: BrowserSettingId): { readonly id: string; readonly title: string };
};

let current: BrowserUIHost | null = null;

export function setBrowserUIHost(host: BrowserUIHost): void {
  current = host;
}

export function uiHost(): BrowserUIHost {
  if (!current) throw new Error("The browser's screens need setBrowserUIHost first.");
  return current;
}
