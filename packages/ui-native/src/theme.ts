import { Appearance, useColorScheme, type TextStyle } from "react-native";

import { phone } from "./phone.ts";
import { designs, space, type Scheme } from "./tokens.ts";

function theme(scheme: Scheme) {
  const { colors, radius, fonts } = designs.otter;
  return {
    scheme,
    colors: { ...colors[scheme], ...phone.colors[scheme] },
    radius,
    fonts: { ...fonts, ...phone.fonts },
    text: phone.text,
    space,
  };
}

export const themes = { light: theme("light"), dark: theme("dark") };

export type Theme = (typeof themes)[Scheme];
export type ColorToken = keyof Theme["colors"];
export type TypeStep = keyof Theme["text"];
export type Weight = "regular" | "medium" | "semibold" | "bold";

/** The tokens for the scheme the app is in: the system's, or the one the user chose. */
export function useTheme(): Theme {
  return themes[useColorScheme() ?? "light"];
}

/**
 * Puts the app in the scheme the user's System / Light / Dark preference says. It sets every
 * window's interface style, so `useColorScheme` and the system's own menus and sheets follow.
 */
export function setSchemePreference(preference: "system" | Scheme): void {
  Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
}

const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/**
 * A step of the type scale in Inter, scaling with Dynamic Type. The weight is set on the
 * variable font's axis too: iOS lists one face for the family, so `fontWeight` alone can't pick it.
 */
export function typeStyle(theme: Theme, step: TypeStep, weight: Weight = "regular"): TextStyle {
  return {
    fontFamily: theme.fonts.sans,
    fontSize: theme.text[step].fontSize,
    fontWeight: String(WEIGHTS[weight]) as TextStyle["fontWeight"],
    fontVariationSettings: { wght: WEIGHTS[weight] },
  };
}

/** A color token at an opacity, as SwiftUI's `.opacity` (hex colors only, as the tokens are). */
export function alpha(color: string, opacity: number): string {
  const hex = color.slice(1, 7);
  const base = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  const value = Math.round(base * opacity * 255);
  return `#${hex}${value.toString(16).padStart(2, "0")}`;
}
