import { Atom } from "effect/reactivity";

import { appAtomRegistry, clientPlatform } from "./client";
import { core } from "./core";

/**
 * The account's `ui` preferences (core's `preferences:getUi`, synced through
 * the Otter account), under the keys the Mac, the web and apps/ios use. A
 * copy stays in client storage so the first frame wears the saved theme.
 */
export type UiPreferences = Partial<Record<string, string>>;

const CACHE_KEY = "mobile:ui-preferences";

function cached(): UiPreferences {
  try {
    return JSON.parse(clientPlatform.storage.getItem(CACHE_KEY) ?? "{}") as UiPreferences;
  } catch {
    return {};
  }
}

export const uiPreferencesAtom = Atom.make<UiPreferences>(cached()).pipe(Atom.keepAlive);

function take(ui: UiPreferences): void {
  appAtomRegistry.set(uiPreferencesAtom, ui);
  clientPlatform.storage.setItem(CACHE_KEY, JSON.stringify(ui));
}

export function setUiPreference(key: string, value: string): void {
  take({ ...appAtomRegistry.get(uiPreferencesAtom), [key]: value });
  void core.invoke("preferences:setUi", { key, value }).catch(() => {});
}

let started = false;

export function startUiPreferences(): void {
  if (started) return;
  started = true;
  void core.invoke<UiPreferences>("preferences:getUi").then(take, () => {});
  core.on("preferences:uiChanged", (ui) => take(ui as UiPreferences));
}

export const flag = (ui: UiPreferences, key: string, fallback: boolean) =>
  ui[key] === undefined ? fallback : ui[key] === "true";
