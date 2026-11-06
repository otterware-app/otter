import { useAtomValue } from "@effect/atom-react";
import { displayedThemeColors, themeColorHex } from "@otter-mail/shared/theme-display";
import {
  APP_THEMES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeDefinition,
} from "@otter-mail/shared/themes";
import { useEffect, useMemo } from "react";
import { Appearance, useColorScheme, type ColorSchemeName } from "react-native";

import { appAtomRegistry } from "../state/client";
import { uiPreferencesAtom, type UiPreferences } from "../state/preferences";

/** The Swift app's Preferences.initialTheme: what a new device wears until the account says otherwise. */
export const INITIAL_THEME = "codex";

export type ThemeSource = "system" | "light" | "dark";

export const themeSource = (ui: UiPreferences): ThemeSource => {
  const value = ui["otter:theme-source"];
  return value === "light" || value === "dark" ? value : "system";
};

export const themeId = (ui: UiPreferences, appearance: ThemeAppearance) =>
  ui[`otter:theme:${appearance}`] ?? INITIAL_THEME;

/** Built-in themes, then the account's own (made on the Mac or the web; worn here, not edited). */
export function availableThemes(ui: UiPreferences): ThemeDefinition[] {
  let own: ThemeDefinition[] = [];
  try {
    const raw = JSON.parse(ui["otter:themes:v1"] ?? "[]") as unknown;
    if (Array.isArray(raw)) {
      own = raw.filter(
        (t): t is ThemeDefinition =>
          typeof t?.id === "string" &&
          typeof t?.label === "string" &&
          (t.appearance === "light" || t.appearance === "dark") &&
          typeof t.colors === "object" &&
          !APP_THEMES.some((b) => b.id === t.id),
      );
    }
  } catch {
    // a list that doesn't parse: the built-ins only
  }
  return [...APP_THEMES, ...own.map((t) => ({ ...t, exact: true, monochrome: true }))];
}

/** The appearances a theme has a palette for. */
export const themeModes = (theme: ThemeDefinition): ThemeAppearance[] =>
  (["light", "dark"] as const).filter((m) => displayedThemeColors(theme, m) !== null);

export type Palette = ReturnType<typeof build>;

const alpha = (hex: string, opacity: number) =>
  `${hex}${Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0")}`;

function build(theme: ThemeDefinition, appearance: ThemeAppearance) {
  const colors =
    displayedThemeColors(theme, appearance) ??
    displayedThemeColors(
      APP_THEMES.find((t) => t.id === "otter")!,
      appearance,
    )!;
  const role = (name: ThemeColorRole, fallback = "#808080") =>
    themeColorHex(colors[name]) ?? fallback;
  const dark = appearance === "dark";
  const text = role("text");
  const canvas = role("canvas");
  return {
    dark,
    canvas,
    background: canvas,
    chrome: role("chrome"),
    sidebar: role("sidebar"),
    surface: role("surface"),
    raised: role("surfaceRaised"),
    text,
    secondary: role("mutedForeground"),
    border: role("border"),
    input: role("input"),
    focus: role("focus"),
    accent: role("messageAction"),
    actionText: role("messageActionForeground"),
    error: role("error"),
    warning: role("warning"),
    /** The Swift app's rows: a hint of the text color over the canvas. */
    card: alpha(text, 0.07),
    unreadCard: alpha(text, 0.04),
    pressed: alpha(text, 0.08),
    selected: alpha(text, 0.1),
    pill: alpha(text, 0.08),
    readText: alpha(text, 0.7),
    readSubject: alpha(text, 0.6),
    snippet: alpha(role("mutedForeground"), 0.8),
    star: text,
    archive: dark ? "#5E5CE6" : "#5856D6",
    trash: dark ? "#FF453A" : "#FF3B30",
  };
}

const built = new Map<string, Palette>();

export function paletteOf(
  themes: readonly ThemeDefinition[],
  id: string,
  appearance: ThemeAppearance,
) {
  const key = `${id}:${appearance}`;
  let palette = built.get(key);
  if (!palette) {
    const theme =
      themes.find((t) => t.id === id) ?? APP_THEMES.find((t) => t.id === INITIAL_THEME)!;
    built.set(key, (palette = build(theme, appearance)));
  }
  return palette;
}

function resolve(ui: UiPreferences, scheme: ColorSchemeName | null | undefined): Palette {
  const appearance: ThemeAppearance = scheme === "dark" ? "dark" : "light";
  return paletteOf(availableThemes(ui), themeId(ui, appearance), appearance);
}

/** The palette for an appearance, in the account's theme (outside React, or where the scheme is at hand). */
export function palette(scheme: ColorSchemeName | null | undefined): Palette {
  return resolve(appAtomRegistry.get(uiPreferencesAtom), scheme);
}

/** The palette the screen wears now: follows the color scheme and the account's theme picks. */
export function usePalette(): Palette {
  const scheme = useColorScheme();
  const ui = useAtomValue(uiPreferencesAtom);
  return useMemo(() => resolve(ui, scheme), [ui, scheme]);
}

/** Keeps the app's color scheme on the account's choice (Settings → Color scheme). */
export function useThemeSource(): void {
  const source = themeSource(useAtomValue(uiPreferencesAtom));
  useEffect(
    () => Appearance.setColorScheme(source === "system" ? "unspecified" : source),
    [source],
  );
}

/** The Swift app's RelativeTime.short: the time today, the weekday this week, the day this year, else the date. */
export function relativeDate(ms: number, now = new Date()): string {
  const date = new Date(ms);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 6) return date.toLocaleDateString(undefined, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "numeric", year: "2-digit" });
}

/** The Swift app's ThreadDay title: Today, Yesterday, or the day. */
export function dayTitle(ms: number, now = new Date()): string {
  const date = new Date(ms);
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
