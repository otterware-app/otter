/**
 * `globalThis.desktopBridge` on the phone: the API the desktop's preload and the web's worker
 * give the screens, over core in this same JavaScript runtime. Calls and events cross here only,
 * as messages, copied as the other hosts' are: neither side holds an object the other changes
 * later, and moving core to a runtime of its own changes this file's transport alone.
 */
import type { BridgeFeatures, DesktopBridge, ThemeSource, UpdateState } from "@otter/contracts";
import { callHandler } from "@otter/core";
import { getLocales } from "expo-localization";
import { AccessibilityInfo, Appearance, Linking } from "react-native";

type Listener = (params: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

/** What core broadcasts (the Platform's `broadcast`), to the screens listening. */
export function emit(channel: string, params?: unknown): void {
  const heard = listeners.get(channel);
  if (!heard?.size) return;
  const copy = structuredClone(params);
  for (const listener of heard) listener(copy);
}

const FEATURES: BridgeFeatures = {
  windowControls: null,
  historyButtons: false,
  swipeNavigation: false,
  launchAtLogin: false,
  dockBadge: false,
  defaultMailApp: false,
  translation: false,
  dragOut: false,
  openFiles: false,
  externalAgent: false,
  localAgents: false,
  browser: false,
  phoneCalls: true,
};

const THEME_SOURCE_KEY = "otter:theme-source";

export function installBridge(options: {
  appVersion: string;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}): void {
  const themeSource = (): ThemeSource => {
    const stored = options.storage.get(THEME_SOURCE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  };
  const applyTheme = (source: ThemeSource) =>
    Appearance.setColorScheme(source === "system" ? "unspecified" : source);
  applyTheme(themeSource());

  const updates: UpdateState = {
    status: "disabled",
    channel: "stable",
    currentVersion: options.appVersion,
    availableVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: "Updates come through the App Store.",
    manualDownloadUrl: null,
  };

  const bridge: DesktopBridge = {
    platform: "ios",
    features: FEATURES,
    async invoke<T>(channel: string, params?: unknown): Promise<T> {
      const reply = await callHandler(channel, structuredClone(params));
      if ("error" in reply) throw new Error(reply.error);
      return structuredClone(reply.result) as T;
    },
    on(channel, listener) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
    openExternal: (url) => Linking.openURL(url),
    region: async () => getLocales()[0]?.regionCode ?? undefined,
    nativeTheme: {
      getInfo: async () => {
        const source = themeSource();
        return {
          shouldUseDarkColors:
            source === "system" ? Appearance.getColorScheme() === "dark" : source === "dark",
          themeSource: source,
          shouldUseHighContrastColors: await AccessibilityInfo.isDarkerSystemColorsEnabled(),
          prefersReducedTransparency: await AccessibilityInfo.isReduceTransparencyEnabled(),
        };
      },
      async setThemeSource(source) {
        options.storage.set(THEME_SOURCE_KEY, source);
        applyTheme(source);
      },
    },
    updates: {
      getState: async () => updates,
      check: async () => updates,
      setChannel: async () => updates,
      download: async () => updates,
      install: async () => {},
      onState: () => () => {},
    },
  };
  (globalThis as { desktopBridge?: DesktopBridge }).desktopBridge = bridge;
}
