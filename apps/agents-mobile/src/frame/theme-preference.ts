import {
  getSyncedPreference,
  onSyncedPreferenceChange,
  setSyncedPreference,
} from "@otter/client/preferences";
import { setSchemePreference } from "@otter/ui-native/theme";

export type SchemeChoice = "system" | "light" | "dark";

const KEY = "otter:theme-source";

/** System / Light / Dark: the account's choice, the same on the Mac and the web. */
export function schemeChoice(): SchemeChoice {
  const value = getSyncedPreference(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export const chooseScheme = (choice: SchemeChoice) => setSyncedPreference(KEY, choice);

/** Wears the account's choice now and whenever it changes, here or on another device. */
export function followSchemePreference(): () => void {
  setSchemePreference(schemeChoice());
  return onSyncedPreferenceChange((key) => {
    if (key === KEY) setSchemePreference(schemeChoice());
  });
}
