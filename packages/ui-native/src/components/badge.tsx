import { View } from "react-native";

import { alpha, useTheme, type ColorToken } from "../theme.ts";
import { Text } from "./text.tsx";

export type BadgeVariant = "outline" | "secondary" | "primary" | "destructive" | "warning";

const LOOK: Record<BadgeVariant, { fill: ColorToken | null; border?: boolean }> = {
  outline: { fill: null, border: true },
  secondary: { fill: null },
  primary: { fill: "primary" },
  destructive: { fill: "error" },
  warning: { fill: "warning" },
};

/**
 * A count or a word in a pill: the tab's unread count (`primary`, 11pt semibold, 16 high), the
 * scheduled tab's "!" (`destructive`), a model's DEFAULT (`secondary`).
 */
export function Badge({
  children,
  variant = "primary",
  accessibilityLabel,
}: {
  children: string | number;
  variant?: BadgeVariant;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const { fill, border } = LOOK[variant];
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{
        minWidth: 16,
        height: 16,
        paddingHorizontal: 5,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: fill ? theme.colors[fill] : alpha(theme.colors.foreground, 0.08),
        borderWidth: border ? 1 : 0,
        borderColor: theme.colors.border,
      }}
    >
      {/* White on a fill in both schemes, as the Swift app's badges. */}
      <Text
        size="2xs"
        weight="semibold"
        color="mutedForeground"
        style={fill && { color: "#ffffff" }}
        tabular
        allowFontScaling={false}
      >
        {children}
      </Text>
    </View>
  );
}

/** The unread dot: 7pt in the accent. */
export function BadgeDot({ color = "primary" }: { color?: ColorToken }) {
  const theme = useTheme();
  return (
    <View
      style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.colors[color] }}
    />
  );
}
