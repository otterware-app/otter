import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { useTheme } from "../theme.ts";
import { IconButton } from "./button.tsx";
import { Text } from "./text.tsx";

export type SheetProps = {
  title: string;
  /** The × at the leading edge: it closes without saving. */
  onCancel?: () => void;
  /** The ✓ at the trailing edge, prominent: it saves and closes. */
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  /** Off for content that scrolls itself (a list). */
  scrolls?: boolean;
  children: ReactNode;
};

/**
 * What a sheet's content sits in, as the Swift app's sheets: the title in the middle, a glass ×
 * and a prominent ✓ beside it, then the grouped content. The route presents it (a form sheet
 * with its detents); this draws inside.
 */
export function Sheet({
  title,
  onCancel,
  onDone,
  doneLabel = "Done",
  doneDisabled,
  scrolls = true,
  children,
}: SheetProps) {
  const theme = useTheme();
  const body = { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 18 };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          minHeight: 60,
        }}
      >
        <View style={{ width: 44 }}>
          {onCancel ? <IconButton icon="xmark" label="Cancel" onPress={onCancel} /> : null}
        </View>
        <Text
          size="lg"
          weight="semibold"
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, textAlign: "center" }}
        >
          {title}
        </Text>
        <View style={{ width: 44 }}>
          {onDone ? (
            <IconButton
              icon="checkmark"
              label={doneLabel}
              variant="glass-prominent"
              disabled={doneDisabled}
              onPress={onDone}
            />
          ) : null}
        </View>
      </View>
      {scrolls ? (
        <ScrollView keyboardDismissMode="interactive" contentContainerStyle={body}>
          {children}
        </ScrollView>
      ) : (
        <View style={[body, { flex: 1 }]}>{children}</View>
      )}
    </View>
  );
}
