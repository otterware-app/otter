import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Clipboard, Pressable, StyleSheet, View } from "react-native";

export function CodeCard({ code, onTrash }: { code: string; onTrash?: () => void }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
      ]}
    >
      <Text
        selectable
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        weight="semibold"
        size="xl"
        style={styles.code}
      >
        {code}
      </Text>
      <Pressable
        testID="otp-copy"
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : onTrash ? "Copy code and trash" : "Copy code"}
        style={[styles.copy, { backgroundColor: alpha(theme.colors.foreground, 0.08) }]}
        onPress={() => {
          Clipboard.setString(code);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setCopied(true);
          onTrash?.();
        }}
      >
        <Icon name={copied ? "checkmark" : "doc.on.doc"} size={17} />
        <Text size="md" weight="medium" numberOfLines={1}>
          {copied ? "Copied" : onTrash ? "Copy & trash" : "Copy"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 7,
    paddingLeft: 16,
  },
  code: { fontFamily: "Menlo", letterSpacing: 1.5, flex: 1 },
  copy: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    minHeight: 44,
    borderRadius: 24,
    gap: 12,
  },
});
