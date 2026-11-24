import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { IconButton } from "./button.tsx";
import { Text } from "./text.tsx";

export type SheetProps = {
  title: string;
  /** The × at the leading edge: it closes without saving. */
  onCancel?: () => void;
  /** What VoiceOver calls the ×: Close for a sheet with nothing to discard. */
  cancelLabel?: string;
  /** The ✓ at the trailing edge, prominent: it saves and closes. */
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  /** SwiftUI's `.tint` on the sheet: the × drawn in it and the ✓ filled with it. */
  tint?: string;
  /** What stands at the trailing edge in place of the ✓: a toolbar toggle ("Show all"). */
  trailing?: ReactNode;
  /** Off for content that scrolls itself (a list). */
  scrolls?: boolean;
  children: ReactNode;
};

/**
 * What a sheet's content sits in, as the Swift app's sheets: the title in the middle, a glass ×
 * and a prominent ✓ beside it, then the grouped content. The route presents it (a form sheet
 * with its detents); this draws inside. The header and the scroll view are the screen's own
 * children, the header not collapsable: react-native-screens sizes a form sheet's scroll view
 * by the view before it.
 */
export function Sheet({
  title,
  onCancel,
  cancelLabel = "Cancel",
  onDone,
  doneLabel = "Done",
  doneDisabled,
  tint,
  trailing,
  scrolls = true,
  children,
}: SheetProps) {
  const [side, setSide] = useState(44);
  const body = { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 18 };
  return (
    <>
      <View
        collapsable={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          minHeight: 60,
        }}
      >
        <View style={{ width: side }}>
          {onCancel ? (
            <IconButton icon="xmark" label={cancelLabel} tint={tint} onPress={onCancel} />
          ) : null}
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
        {trailing ? (
          <View
            style={{ minWidth: 44, alignItems: "flex-end" }}
            onLayout={(event) => setSide(Math.max(44, event.nativeEvent.layout.width))}
          >
            {trailing}
          </View>
        ) : (
          <View style={{ width: 44 }}>
            {onDone ? (
              <IconButton
                icon="checkmark"
                label={doneLabel}
                variant="glass-prominent"
                tint={tint}
                disabled={doneDisabled}
                onPress={onDone}
              />
            ) : null}
          </View>
        )}
      </View>
      {scrolls ? (
        <ScrollView keyboardDismissMode="interactive" contentContainerStyle={body}>
          {children}
        </ScrollView>
      ) : (
        <View style={[body, { flex: 1 }]}>{children}</View>
      )}
    </>
  );
}
