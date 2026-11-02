import { readJson, writeJson } from "../json-file.js";

import { DEFAULT_SETTINGS, type AppSettings } from "@otter-mail/contracts";
export { DEFAULT_SETTINGS, type AppSettings, type NotificationsMode } from "@otter-mail/contracts";

export async function getSettings(): Promise<AppSettings> {
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<AppSettings>>("settings.json")) };
}

type SettingsListener = (settings: AppSettings, patch: Partial<AppSettings>) => void;
const listeners = new Set<SettingsListener>();

export function onSettingsChanged(listener: SettingsListener): void {
  listeners.add(listener);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const updated = { ...(await getSettings()), ...patch };
  await writeJson("settings.json", updated);
  for (const listener of listeners) listener(updated, patch);
  return updated;
}
