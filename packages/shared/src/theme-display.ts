/**
 * Themes as Otter Mail paints them. The web app (apps/web's apply-theme.ts)
 * paints only some of a theme's roles, and blends a built-in's structure
 * colors toward the surface they sit on, keeping `keep` of the role, unless
 * the theme is `exact`. Themes of your own are painted exactly as stored, so a
 * copy of a built-in starts from these blended colors (the theme editor, and
 * the agent's theme tools in core).
 */

import {
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "./theme-palettes.ts";

export const PAINTED_ROLES: Readonly<Partial<Record<ThemeColorRole, string>>> = {
  canvas: "the app's background",
  chrome: "the window's top bar",
  text: "text",
  surface: "cards",
  surfaceRaised: "raised surfaces and the composer",
  surfaceOverlay: "menus and popovers",
  messageAction: "buttons, unread dots and other accents (the primary color)",
  messageActionForeground: "text and icons on buttons",
  secondary: "secondary buttons",
  secondaryForeground: "text on secondary buttons",
  muted: "quiet backgrounds",
  mutedForeground: "muted text",
  placeholder: "placeholders in fields",
  secondaryLabel: "secondary labels",
  iconMuted: "muted icons",
  accentSurface: "hovered and selected rows",
  accentSurfaceForeground: "text on hovered and selected rows",
  messageSurface: "your messages in the agent chat",
  messageForeground: "text of your messages in the agent chat",
  codeBackground: "code blocks",
  codeForeground: "code text",
  border: "borders and dividers",
  input: "field borders",
  focus: "focus rings",
  error: "errors",
  errorForeground: "error text",
  errorSurface: "error backgrounds",
  warning: "warnings",
  warningForeground: "warning text",
  warningSurface: "warning backgrounds",
  sidebar: "the sidebar's background",
  sidebarForeground: "the sidebar's text",
  sidebarMutedForeground: "the sidebar's muted text",
  sidebarControlSurface: "controls in the sidebar",
  sidebarRowHover: "hovered rows in the sidebar",
  sidebarRowActive: "pressed rows in the sidebar",
  sidebarRowSelected: "the selected row in the sidebar",
  sidebarBorder: "the sidebar's lines",
};

export const SOFTENED_ROLES: Readonly<
  Partial<Record<ThemeColorRole, readonly [over: ThemeColorRole, keep: number]>>
> = {
  surface: ["canvas", 0.6],
  surfaceRaised: ["canvas", 0.45],
  secondary: ["canvas", 0.55],
  muted: ["canvas", 0.55],
  accentSurface: ["canvas", 0.45],
  messageSurface: ["canvas", 0.7],
  border: ["canvas", 0.35],
  input: ["canvas", 0.5],
  codeBackground: ["canvas", 0.6],
  sidebarControlSurface: ["sidebar", 0.5],
  sidebarRowHover: ["sidebar", 0.45],
  sidebarRowActive: ["sidebar", 0.5],
  sidebarRowSelected: ["sidebar", 0.5],
  sidebarBorder: ["sidebar", 0.3],
};

export function softenThemeColors(colors: ThemeColors): ThemeColors {
  const softened: Record<ThemeColorRole, string> = { ...colors };
  for (const [role, [over, keep]] of Object.entries(SOFTENED_ROLES) as Array<
    [ThemeColorRole, readonly [ThemeColorRole, number]]
  >) {
    const mixed = mixOklab(colors[role], colors[over], keep);
    if (mixed) softened[role] = mixed;
  }
  return softened;
}

/**
 * A theme's palette for an appearance as the app paints it: blended for a
 * built-in that isn't `exact` (the stock "otter" palette is styles.css's own,
 * never blended); null when the theme has no palette for it.
 */
export function displayedThemeColors(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  const colors = getThemeColorsForAppearance(theme, appearance);
  if (!colors) return null;
  return theme.exact || theme.id === "otter" ? colors : softenThemeColors(colors);
}

type Oklab = [number, number, number];

function toOklab(css: string): Oklab | null {
  const value = css.trim().toLowerCase();
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (oklch) {
    const [l, c, h] = [Number(oklch[1]), Number(oklch[2]), (Number(oklch[3]) * Math.PI) / 180];
    return [l, c * Math.cos(h), c * Math.sin(h)];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((i) => linear(Number.parseInt(full.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function toHex([L, a, b]: Oklab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return `#${[
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
    .map((c) =>
      Math.round(gamma(c) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function gamma(c: number): number {
  const clamped = Math.min(Math.max(c, 0), 1);
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function mixOklab(color: string, over: string, keep: number): string | null {
  const [x, y] = [toOklab(color), toOklab(over)];
  if (!x || !y) return null;
  return toHex([0, 1, 2].map((i) => x[i]! * keep + y[i]! * (1 - keep)) as Oklab);
}
