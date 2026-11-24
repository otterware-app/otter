import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { haptics } from "../haptics.ts";
import { alpha, useTheme } from "../theme.ts";
import { Glass } from "./glass.tsx";
import { Icon } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ChipProps = {
  text: string;
  /** `filter`: WhatsApp's filter chips over a list. `glass`: a picker's chip with a chevron, over content. */
  variant?: "filter" | "glass";
  selected?: boolean;
  count?: number;
  /** What leads it: an agent's avatar at 14. */
  leading?: ReactNode;
  /** An × after the text: tapping it clears the filter. */
  removable?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function Chip({
  text,
  variant = "filter",
  selected = false,
  count = 0,
  leading,
  removable = false,
  onPress,
  accessibilityLabel,
}: ChipProps) {
  const theme = useTheme();
  const color = selected ? "foreground" : "mutedForeground";
  const content = (
    <>
      {leading}
      <Text size="sm" weight="medium" color={color} numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Text>
      {count > 0 ? (
        <Text size="sm" color="faintForeground" tabular>
          {count}
        </Text>
      ) : null}
      {removable ? <Icon name="xmark" size={9} weight="bold" color="faintForeground" /> : null}
      {variant === "glass" ? (
        // SwiftUI's 10pt chevron: Icon fits a symbol to a box wider than its size, which a
        // chevron, wide and short, fills.
        <Icon name="chevron.down" size={7} weight="semibold" color={color} />
      ) : null}
    </>
  );
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: variant === "glass" ? 6 : 5,
  };
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (removable ? `${text}, show all` : count > 0 ? `${text} (${count})` : text)
      }
      accessibilityState={{ selected }}
      style={{ minHeight: 44, justifyContent: "center" }}
    >
      {variant === "glass" ? (
        <Glass
          interactive
          shape={{ radius: 14 }}
          tint={selected ? alpha(theme.colors.foreground, 0.12) : undefined}
          style={[row, { minHeight: 30, maxWidth: 200, paddingHorizontal: 12 }]}
        >
          {content}
        </Glass>
      ) : (
        <View
          style={[
            row,
            {
              height: 32,
              paddingHorizontal: 12,
              borderRadius: 16,
              backgroundColor: selected
                ? alpha(theme.colors.primary, 0.16)
                : alpha(theme.colors.foreground, 0.06),
            },
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}
