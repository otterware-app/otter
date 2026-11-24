import type { ReactNode } from "react";
import { View } from "react-native";

import { alpha, useTheme, type ColorToken } from "../theme.ts";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type AlertVariant = "error" | "warning" | "info" | "success";

const LOOK: Record<AlertVariant, { icon: IconName; color: ColorToken }> = {
  error: { icon: "exclamationmark.circle.fill", color: "errorForeground" },
  warning: { icon: "exclamationmark.triangle.fill", color: "warningForeground" },
  info: { icon: "info.circle.fill", color: "infoForeground" },
  success: { icon: "checkmark.circle.fill", color: "successForeground" },
};

/** A banner in a screen: what went wrong or wants attention, and what to do about it. */
export function Alert({
  variant = "info",
  title,
  description,
  action,
}: {
  variant?: AlertVariant;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const theme = useTheme();
  const { icon, color } = LOOK[variant];
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 14,
        borderRadius: theme.radius["2xl"],
        borderCurve: "continuous",
        backgroundColor: alpha(theme.colors[color], 0.1),
      }}
    >
      <Icon name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text size="md" weight="semibold">
          {title}
        </Text>
        {description ? (
          <Text size="sm" color="mutedForeground">
            {description}
          </Text>
        ) : null}
        {action ? <View style={{ marginTop: 8, flexDirection: "row" }}>{action}</View> : null}
      </View>
    </View>
  );
}
