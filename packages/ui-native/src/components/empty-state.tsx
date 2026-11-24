import type { ReactNode } from "react";
import { View } from "react-native";

import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

/** SwiftUI's `ContentUnavailableView`: a symbol, a title, a line, and what to do about it. */
export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 32, paddingVertical: 24, gap: 8 }}>
      {icon ? (
        <Icon name={icon} size={44} color="mutedForeground" style={{ marginBottom: 8 }} />
      ) : null}
      <Text size="xl" weight="bold" accessibilityRole="header" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {description ? (
        <Text size="base" color="mutedForeground" style={{ textAlign: "center" }}>
          {description}
        </Text>
      ) : null}
      {actions ? (
        <View style={{ marginTop: 12, gap: 8, alignItems: "center" }}>{actions}</View>
      ) : null}
    </View>
  );
}
