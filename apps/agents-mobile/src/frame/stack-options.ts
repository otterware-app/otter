import { typeStyle, useTheme } from "@otter/ui-native/theme";
import type { ComponentProps } from "react";
import type { Stack } from "expo-router";

type ScreenOptions = NonNullable<ComponentProps<typeof Stack>["screenOptions"]>;

/**
 * Every stack's chrome: the title inline in Inter's headline, on the canvas, no hairline, the
 * back button its chevron alone. A screen sets its own title and toolbar (`<Stack.Screen options>`
 * or `<Stack.Toolbar>`).
 */
export function useStackOptions(): Exclude<ScreenOptions, (...args: never[]) => unknown> {
  const theme = useTheme();
  const title = typeStyle(theme, "lg", "semibold");
  return {
    headerTintColor: theme.colors.foreground,
    headerStyle: { backgroundColor: theme.colors.canvas },
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: title.fontFamily, fontSize: title.fontSize, fontWeight: "600" },
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: theme.colors.canvas },
  };
}
