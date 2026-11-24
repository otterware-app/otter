import { host } from "@otter/client/host";
import {
  getSyncedPreference,
  onSyncedPreferenceChange,
  setSyncedPreference,
  type SyncedKey,
} from "@otter/client/preferences";
import { setSchemePreference } from "@otter/ui-native/theme";
import { useSyncExternalStore } from "react";

export function usePreference(key: SyncedKey) {
  return useSyncExternalStore(onSyncedPreferenceChange, () => getSyncedPreference(key));
}

export function followColorScheme() {
  const apply = () => {
    const value = getSyncedPreference("otter:theme-source");
    setSchemePreference(value === "light" || value === "dark" ? value : "system");
  };
  apply();
  return onSyncedPreferenceChange((key) => {
    if (key === "otter:theme-source") apply();
  });
}

export type MailboxArrangement = { order: string[]; off: string[] };

export function useMailboxArrangement(): MailboxArrangement {
  const value = usePreference("mail:mailboxes");
  try {
    const saved = JSON.parse(value ?? "{}") as Partial<MailboxArrangement>;
    return {
      order: Array.isArray(saved?.order) ? saved.order : [],
      off: Array.isArray(saved?.off) ? saved.off : [],
    };
  } catch {
    return { order: [], off: [] };
  }
}

export function setMailboxArrangement(arrangement: MailboxArrangement) {
  setSyncedPreference("mail:mailboxes", JSON.stringify(arrangement));
}

const fullWidthKey = "otter:full-width-messages";
const widthListeners = new Set<() => void>();

export function useFullWidthMessages() {
  return useSyncExternalStore(
    (listener) => {
      widthListeners.add(listener);
      return () => widthListeners.delete(listener);
    },
    () => host().storage.get(fullWidthKey) === "true",
  );
}

export function setFullWidthMessages(value: boolean) {
  host().storage.set(fullWidthKey, String(value));
  for (const listener of widthListeners) listener();
}
