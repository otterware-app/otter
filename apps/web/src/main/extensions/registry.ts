/**
 * The extensions this renderer has (their `./ui` halves), in the order
 * Settings lists them (Agents, Integrations, Features), and which are on. Every built-in starts
 * on; turning one off is a UI choice that follows the Otter account
 * (synced-preferences.ts). Agents are the exception: their switch is the
 * agent's own on/off (core's agent settings).
 */

import calendarInvites from "@otter-mail/extension-calendar-invites/ui";
import claude from "@otter-mail/extension-claude/ui";
import codex from "@otter-mail/extension-codex/ui";
import hermes from "@otter-mail/extension-hermes/ui";
import openclaw from "@otter-mail/extension-openclaw/ui";
import openrouter from "@otter-mail/extension-openrouter/ui";
import signInCodes from "@otter-mail/extension-sign-in-codes/ui";
import todoist from "@otter-mail/extension-todoist/ui";
import translation from "@otter-mail/extension-translation/ui";
import { useMemo, useSyncExternalStore } from "react";

import { runsOn, type AppPlatform, type ExtensionCategory } from "@otter-mail/contracts/extensions";

import type { SettingsPane } from "../mail/api";
import { setSyncedPreference } from "../synced-preferences";
import type { AgentContribution, UiExtension } from "./types";

/** Every extension this build has, whether or not this app can run it. */
export const EXTENSIONS: readonly UiExtension[] = [
  signInCodes,
  calendarInvites,
  translation,
  todoist,
  openrouter,
  hermes,
  openclaw,
  codex,
  claude,
];

/** The settings pane each kind of extension lives in (under "Extensions" in the sidebar). */
export const CATEGORY_PANE: Record<ExtensionCategory, SettingsPane> = {
  agent: "agents",
  integration: "integrations",
  mail: "features",
};

/** Which app this is, for extensions' manifest `platforms`. */
const APP_PLATFORM: AppPlatform =
  window.desktopBridge.platform === "web"
    ? "web"
    : window.desktopBridge.platform === "darwin"
      ? "mac"
      : "linux";

/**
 * The extensions this app can run: those whose manifest includes it (the web
 * app has no Claude or Codex), and that say they're available here.
 */
export function availableExtensions(): readonly UiExtension[] {
  return EXTENSIONS.filter((e) => runsOn(e.manifest, APP_PLATFORM) && (e.available?.() ?? true));
}

const DISABLED_KEY = "otter:extensions:disabled";
const CHANGE_EVENT = "otter:extensions-changed";

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

/** The ids of the extensions turned off, kept live. */
export function useDisabledExtensions(): ReadonlySet<string> {
  // The raw string is the snapshot, so the set is only rebuilt when it changes.
  const raw = useSyncExternalStore(subscribe, readDisabled);
  return useMemo(() => parseDisabled(raw), [raw]);
}

/** Turns a (non-agent) extension on or off, here and on every device. */
export function setExtensionEnabled(id: string, enabled: boolean): void {
  const disabled = new Set(parseDisabled(readDisabled()));
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  setSyncedPreference(DISABLED_KEY, JSON.stringify([...disabled].sort()));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The extensions that are on in this app, for the slots to draw. */
export function useEnabledExtensions(): readonly UiExtension[] {
  const disabled = useDisabledExtensions();
  return useMemo(
    () => availableExtensions().filter((e) => !e.agent && !disabled.has(e.manifest.id)),
    [disabled],
  );
}

/** An agent's renderer side (icon, settings form), whether or not it's on. */
export function agentContribution(kind: string): AgentContribution | undefined {
  return EXTENSIONS.find((e) => e.manifest.id === kind)?.agent;
}
