import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { alpha, useTheme } from "../theme.ts";
import { Text } from "./text.tsx";

export type ListRowProps = {
  title: string;
  /** One quiet line under the title. */
  subtitle?: string;
  leading?: ReactNode;
  /** At the title's end: a time, an agent's mark, a count. */
  trailing?: ReactNode;
  /** At the subtitle's end: a pin, a badge. */
  detail?: ReactNode;
  /** Unread: the title bolder. */
  emphasized?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
};

/** A row of a list as WhatsApp's and T3 Code's: the title and one line under it, the words leading. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  detail,
  emphasized = false,
  onPress,
  onLongPress,
  accessibilityLabel,
}: ListRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor:
          pressed && onPress ? alpha(theme.colors.foreground, 0.06) : theme.colors.canvas,
      })}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            size="lg"
            weight={emphasized ? "semibold" : "regular"}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {title}
          </Text>
          {trailing}
        </View>
        {subtitle || detail ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text size="md" color="mutedForeground" numberOfLines={1} style={{ flex: 1 }}>
              {subtitle}
            </Text>
            {detail}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
