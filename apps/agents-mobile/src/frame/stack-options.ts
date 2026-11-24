import { typeStyle, useTheme } from "@otter/ui-native/theme";
import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

export type ScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack>["screenOptions"]>,
  (...args: never[]) => unknown
>;

/**
 * Every stack's chrome: the title inline in Inter's headline, on the canvas, no hairline, the
 * back button its chevron alone. A screen sets its own title, toolbar and menus from inside
 * (`<Stack.Screen options>`, `<Stack.Toolbar>`). Untitled until it does: React Navigation
 * otherwise titles a screen by its route's file ("index", "settings/index") until the screen's
 * own options arrive, and a first screen with no title (Chats) keeps none.
 */
export function useStackOptions(): ScreenOptions {
  const theme = useTheme();
  const title = typeStyle(theme, "lg", "semibold");
  return {
    title: "",
    headerTintColor: theme.colors.foreground,
    headerStyle: { backgroundColor: theme.colors.canvas },
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: title.fontFamily, fontSize: title.fontSize, fontWeight: "600" },
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: theme.colors.canvas },
  };
}

/**
 * A sheet from the bottom, as SwiftUI's `.sheet`: full height unless `detents` says otherwise,
 * with its grabber (every sheet of the Swift app's has `.presentationDragIndicator(.visible)`).
 */
export const sheet = (detents: number[] = [1]): ScreenOptions => ({
  presentation: "formSheet",
  sheetAllowedDetents: detents,
  sheetGrabberVisible: true,
  headerShown: false,
});

/** A screen over everything, as SwiftUI's `.fullScreenCover`: Talk, the browser. */
export const cover: ScreenOptions = { presentation: "fullScreenModal", headerShown: false };
