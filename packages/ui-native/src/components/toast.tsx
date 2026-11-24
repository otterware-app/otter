import { Pressable, View } from "react-native";

import { Glass } from "./glass.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ToastProps = {
  text: string;
  icon?: IconName;
  action?: { label: string; run: () => void };
  /** Tapping it anywhere but its action. */
  onPress?: () => void;
};

/**
 * Design.swift's `Toast`: a glass pill of words over the list, with an action. The app places
 * it and lets it go; `@otter/mobile/notices` says what's showing.
 */
export function Toast({ text, icon = "checkmark.circle", action, onPress }: ToastProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: 24 }}
    >
      <Glass
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          minHeight: 48,
          paddingHorizontal: 16,
        }}
      >
        <Icon name={icon} size={18} color="mutedForeground" />
        <Text size="sm" numberOfLines={2} style={{ flexShrink: 1 }}>
          {text}
        </Text>
        {action ? (
          <>
            <View style={{ flex: 1, minWidth: 8 }} />
            <Pressable onPress={action.run} accessibilityRole="button" hitSlop={12}>
              <Text size="sm" weight="semibold">
                {action.label}
              </Text>
            </Pressable>
          </>
        ) : null}
      </Glass>
    </Pressable>
  );
}
