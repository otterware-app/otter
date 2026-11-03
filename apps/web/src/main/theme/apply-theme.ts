import type { ThemeSource } from "@otter-mail/contracts";
import { setSyncedPreference } from "../synced-preferences";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  APP_THEMES,
  OTTER_DARK_THEME_COLORS,
  OTTER_LIGHT_THEME_COLORS,
  OTTER_THEME,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "@otter-mail/shared/themes";
import { getCustomThemes, subscribeToCustomThemes } from "./themePalette";

export const DEFAULT_THEME_ID = OTTER_THEME.id;
export const INITIAL_THEME_ID = DEFAULT_THEME_ID;

const STORAGE_KEY: Record<ThemeAppearance, "otter:theme:light" | "otter:theme:dark"> = {
  light: "otter:theme:light",
  dark: "otter:theme:dark",
};
const CHANGE_EVENT = "otter:theme-change";

function findTheme(id: string): ThemeDefinition | undefined {
  return APP_THEMES.find((t) => t.id === id) ?? getCustomThemes().find((t) => t.id === id);
}

export function useAppThemes(): ReadonlyArray<ThemeDefinition> {
  const custom = useSyncExternalStore(subscribeToCustomThemes, getCustomThemes);
  return [...APP_THEMES, ...custom];
}

export type ThemeChoice = Record<ThemeAppearance, string>;

export function getThemeChoice(): ThemeChoice {
  const read = (mode: ThemeAppearance) => {
    const id = localStorage.getItem(STORAGE_KEY[mode]);
    return id && findTheme(id) ? id : INITIAL_THEME_ID;
  };
  return { light: read("light"), dark: read("dark") };
}

export function setThemeForAppearance(mode: ThemeAppearance, themeId: string): void {
  console.log("[AppTheme:set]", { mode, themeId });
  setSyncedPreference(STORAGE_KEY[mode], themeId);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * System, Light or Dark, here and with the account. The choice is stored
 * before the window's appearance flips: `appearance()` reads it, and the
 * media query's change can fire before the native call returns.
 */
export async function setColorScheme(scheme: ThemeSource): Promise<void> {
  setSyncedPreference("otter:theme-source", scheme);
  await window.desktopBridge.nativeTheme.setThemeSource(scheme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function themeColors(themeId: string, mode: ThemeAppearance): ThemeColors {
  const theme = findTheme(themeId) ?? OTTER_THEME;
  return (
    getThemeColorsForAppearance(theme, mode) ??
    (mode === "dark" ? OTTER_DARK_THEME_COLORS : OTTER_LIGHT_THEME_COLORS)
  );
}

/**
 * The built-in palettes carry opaque, fairly strong structure colors (borders,
 * row highlights, raised surfaces) — several steps above their canvas, where
 * the stock palette keeps those a hair off the background. Blend each back
 * toward the surface it sits on so themes keep their hue but match the stock
 * palette's quiet contrast. Text and accent roles are left as designed.
 */
function softenColor(color: string, over: string, keep: number): string {
  return `color-mix(in oklab, ${color} ${keep}%, ${over})`;
}

const VARIABLES: ReadonlyArray<
  readonly [variable: string, role: ThemeColorRole, soften?: readonly [ThemeColorRole, number]]
> = [
  ["--canvas", "canvas"],
  ["--app-chrome-background", "chrome"],
  ["--foreground", "text"],
  ["--card", "surface", ["canvas", 60]],
  ["--card-foreground", "text"],
  ["--popover", "surfaceOverlay"],
  ["--popover-foreground", "text"],
  ["--surface-raised", "surfaceRaised", ["canvas", 45]],
  ["--chat-composer-surface", "surfaceRaised", ["canvas", 45]],
  ["--primary", "messageAction"],
  ["--primary-foreground", "messageActionForeground"],
  ["--secondary", "secondary", ["canvas", 55]],
  ["--secondary-foreground", "secondaryForeground"],
  ["--muted", "muted", ["canvas", 55]],
  ["--muted-foreground", "mutedForeground"],
  ["--placeholder", "placeholder"],
  ["--secondary-label", "secondaryLabel"],
  ["--icon-muted", "iconMuted"],
  ["--accent-surface", "accentSurface", ["canvas", 45]],
  ["--accent-surface-foreground", "accentSurfaceForeground"],
  ["--message-surface", "messageSurface", ["canvas", 70]],
  ["--message-foreground", "messageForeground"],
  ["--error", "error"],
  ["--error-foreground", "errorForeground"],
  ["--error-surface", "errorSurface"],
  ["--destructive", "error"],
  ["--destructive-foreground", "errorForeground"],
  ["--warning", "warning"],
  ["--warning-foreground", "warningForeground"],
  ["--warning-surface", "warningSurface"],
  ["--border", "border", ["canvas", 35]],
  ["--input", "input", ["canvas", 50]],
  ["--ring", "focus"],
  ["--sidebar-surface", "sidebar"],
  ["--sidebar-foreground", "sidebarForeground"],
  ["--sidebar-muted-foreground", "sidebarMutedForeground"],
  ["--sidebar-control-surface", "sidebarControlSurface", ["sidebar", 50]],
  ["--sidebar-row-hover", "sidebarRowHover", ["sidebar", 45]],
  ["--sidebar-row-active", "sidebarRowActive", ["sidebar", 50]],
  ["--sidebar-row-selected", "sidebarRowSelected", ["sidebar", 50]],
  ["--sidebar-line", "sidebarBorder", ["sidebar", 30]],
  ["--code-background", "codeBackground", ["canvas", 60]],
  ["--code-foreground", "codeForeground"],
];

function cssVariables(c: ThemeColors, exact: boolean): string {
  return VARIABLES.map(([variable, role, soften]) => {
    const value = soften && !exact ? softenColor(c[role], c[soften[0]], soften[1]) : c[role];
    return `  ${variable}: ${value};`;
  }).join("\n");
}

export function themeRoleVariables(role: ThemeColorRole): ReadonlyArray<string> {
  return VARIABLES.filter(([, r]) => r === role).map(([variable]) => variable);
}

const STYLE_ID = "otter-app-theme";

export function appearance(): ThemeAppearance {
  const chosen = localStorage.getItem("otter:theme-source");
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let previewId: string | null = null;

let draft: { colors: ThemeColors; appearance: ThemeAppearance } | null = null;

export function applyThemeColorPreview(colors: ThemeColors, appearance: ThemeAppearance): void {
  draft = { colors, appearance };
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function refreshTheme(): void {
  draft = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const isCustom = (id: string) => !APP_THEMES.some((t) => t.id === id);

export function previewTheme(themeId: string | null): void {
  if (previewId === themeId) return;
  previewId = themeId;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

let settleFrame = 0;

/**
 * Switching themes repaints everything in one frame: without this, elements
 * with color transitions fade at their own pace while the rest snap.
 */
function withoutTransitions(root: HTMLElement): void {
  root.setAttribute("data-theme-switching", "");
  cancelAnimationFrame(settleFrame);
  settleFrame = requestAnimationFrame(() => {
    settleFrame = requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  });
}

export function applyAppTheme(): void {
  const mode = draft?.appearance ?? appearance();
  const themeId = draft ? "__preview" : (previewId ?? getThemeChoice()[mode]);
  const colors = draft?.colors ?? themeColors(themeId, mode);
  const exact = draft !== null || isCustom(themeId) || (findTheme(themeId)?.exact ?? false);

  const root = document.documentElement;
  withoutTransitions(root);
  root.classList.toggle("dark", mode === "dark");
  let style = document.getElementById(STYLE_ID);
  if (themeId === DEFAULT_THEME_ID) {
    root.removeAttribute("data-theme-id");
    style?.remove();
    return;
  }
  root.setAttribute("data-theme-id", themeId);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
  }
  style.textContent = `html[data-theme-id],\nhtml[data-theme-id] [data-app-sidebar] {\n${cssVariables(colors, exact)}\n}`;
  document.head.appendChild(style);
}

export function startAppTheme(): () => void {
  applyAppTheme();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY.light || e.key === STORAGE_KEY.dark) applyAppTheme();
  };
  mq.addEventListener("change", applyAppTheme);
  window.addEventListener(CHANGE_EVENT, applyAppTheme);
  window.addEventListener("storage", onStorage);
  const unsubscribe = subscribeToCustomThemes(applyAppTheme);
  return () => {
    mq.removeEventListener("change", applyAppTheme);
    window.removeEventListener(CHANGE_EVENT, applyAppTheme);
    window.removeEventListener("storage", onStorage);
    unsubscribe();
  };
}

function isMonochrome(): boolean {
  if (draft) return true;
  const id = previewId ?? getThemeChoice()[appearance()];
  return isCustom(id) || (findTheme(id)?.monochrome ?? false);
}

export function useMonochromeTheme(): boolean {
  const [monochrome, setMonochrome] = useState(isMonochrome);
  useEffect(() => {
    const update = () => setMonochrome(isMonochrome());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return monochrome;
}

export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState(getThemeChoice);
  useEffect(() => {
    const update = () => setChoice(getThemeChoice());
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return choice;
}
