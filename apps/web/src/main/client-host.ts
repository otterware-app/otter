import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { startChats, useChats } from "@otter/client/agents/chat-store";
import { setHost } from "@otter/client/host";
import {
  loadSyncedPreferences,
  onSyncedPreferenceArrival,
  syncedPreferenceChanged,
} from "@otter/client/preferences";
import type { ThemeSource } from "@otter/contracts";
import { toast } from "@otter/ui/components/toast";
import { startWebPresence } from "./agent/web-presence";
import { closeChatPages } from "@otter/browser/ui/store";
import { startBrowserUI } from "./browser/browser-host";
import { agentContribution } from "./extensions/registry";

const marks = new Map<string, string>();

function agentMark(kind: string): string | undefined {
  const Icon = agentContribution(kind)?.Icon;
  if (!Icon) return undefined;
  let svg = marks.get(kind);
  if (svg === undefined) {
    const host = document.createElement("div");
    const root = createRoot(host);
    flushSync(() => root.render(createElement(Icon)));
    svg = host.innerHTML.replace(/^<svg(?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"');
    root.unmount();
    marks.set(kind, svg);
  }
  return svg || undefined;
}

/** @otter/client in this window, with its host: before the app renders. */
export async function startClient(): Promise<void> {
  startBrowserUI();
  window.addEventListener("storage", (event) => {
    // Another window's; this window's own (below) are dispatched, so untrusted.
    if (event.isTrusted && event.key) syncedPreferenceChanged(event.key);
  });
  // The window's readers of a synced preference hear another device's as they hear another window's.
  onSyncedPreferenceArrival((key, value) => {
    if (key === "otter:theme-source")
      void window.desktopBridge.nativeTheme.setThemeSource(value as ThemeSource);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
  setHost({
    storage: {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    },
    focused: () => document.hasFocus(),
    onFocusChange: (listener) => {
      window.addEventListener("focus", listener);
      window.addEventListener("blur", listener);
      return () => {
        window.removeEventListener("focus", listener);
        window.removeEventListener("blur", listener);
      };
    },
    onLeave: (listener) => {
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
    notice: ({ tone, title, body, timeout, action, onGone }) => {
      const id = toast[tone](title, {
        description: body,
        timeout,
        action: action && { label: action.label, onClick: action.run },
        onRemove: onGone,
      });
      return () => toast.close(id);
    },
    agentMark,
  });
  // The browser's first render wears the account's palette.
  if (window.desktopBridge.platform === "web")
    await loadSyncedPreferences(true).catch((err) =>
      console.warn("Couldn't load UI preferences", err),
    );
  startChats();
  // A chat gone takes the pages it had open with it.
  useChats.subscribe((state, prev) => {
    if (state.conversations === prev.conversations) return;
    const kept = new Set(state.conversations.map((c) => c.id));
    for (const c of prev.conversations) if (!kept.has(c.id)) closeChatPages(c.id);
  });
  if (window.desktopBridge.platform === "web") startWebPresence();
}
