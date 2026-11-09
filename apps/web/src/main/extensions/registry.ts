import calendarInvites from "@otter/extension-calendar-invites/ui";
import claude from "@otter/extension-claude/ui";
import codex from "@otter/extension-codex/ui";
import hermes from "@otter/extension-hermes/ui";
import openclaw from "@otter/extension-openclaw/ui";
import openrouter from "@otter/extension-openrouter/ui";
import otterDrive from "@otter/extension-otter-drive/ui";
import signInCodes from "@otter/extension-sign-in-codes/ui";
import todoist from "@otter/extension-todoist/ui";
import translation from "@otter/extension-translation/ui";
import varys from "@otter/extension-varys/ui";
import { useMemo, useSyncExternalStore } from "react";

import { runsOn, type AppPlatform, type ExtensionCategory } from "@otter/contracts/extensions";

import type { SettingsPane } from "../mail/api";
import { setSyncedPreference } from "../synced-preferences";
import type { AgentContribution, UiExtension } from "./types";

export const EXTENSIONS: readonly UiExtension[] = [
  signInCodes,
  calendarInvites,
  translation,
  todoist,
  otterDrive,
  openrouter,
  hermes,
  openclaw,
  varys,
  codex,
  claude,
];

export const CATEGORY_PANE: Record<ExtensionCategory, SettingsPane> = {
  agent: "agents",
  integration: "integrations",
  connection: "accounts",
  mail: "features",
};

const APP_PLATFORM: AppPlatform =
  window.desktopBridge.platform === "web"
    ? "web"
    : window.desktopBridge.platform === "darwin"
      ? "mac"
      : "linux";

export function availableExtensions(): readonly UiExtension[] {
  return EXTENSIONS.filter((e) => runsOn(e.manifest, APP_PLATFORM) && (e.available?.() ?? true));
}

export function hasIntegrations(): boolean {
  return availableExtensions().some((e) => e.manifest.category === "integration");
}

const DISABLED_KEY = "otter:extensions:disabled";
const CHANGE_EVENT = "otter:extensions-changed";

export function extensionEnabled(id: string): boolean {
  return !parseDisabled(readDisabled()).has(id);
}

function readDisabled(): string {
  return localStorage.getItem(DISABLED_KEY) ?? "[]";
}

function parseDisabled(raw: string): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === DISABLED_KEY && onChange();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDisabledExtensions(): ReadonlySet<string> {
  // The raw string is the snapshot, so the set is only rebuilt when it changes.
  const raw = useSyncExternalStore(subscribe, readDisabled);
  return useMemo(() => parseDisabled(raw), [raw]);
}

export function setExtensionEnabled(id: string, enabled: boolean): void {
  const disabled = new Set(parseDisabled(readDisabled()));
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  setSyncedPreference(DISABLED_KEY, JSON.stringify([...disabled].sort()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useEnabledExtensions(): readonly UiExtension[] {
  const disabled = useDisabledExtensions();
  return useMemo(
    () => availableExtensions().filter((e) => !e.agent && !disabled.has(e.manifest.id)),
    [disabled],
  );
}

export function agentContribution(kind: string): AgentContribution | undefined {
  return EXTENSIONS.find((e) => e.manifest.id === kind)?.agent;
}
