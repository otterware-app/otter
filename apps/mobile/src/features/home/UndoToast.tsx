import { onUndoableAction, type UndoAction } from "@otter-mail/client-runtime/operations";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { operations } from "../../state/client";
import { usePalette } from "../theme";

/** The Swift app's undo bar: "Archived" and Undo over the places bar, for a few seconds after each undoable action. */
export function UndoToast() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ title: string; action: UndoAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      onUndoableAction((title, action) => {
        setToast({ title, action });
        AccessibilityInfo.announceForAccessibility(`${title}. Undo is available.`);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(null), 6000);
      }),
    [],
  );

  if (!toast) return null;
  return (
    <View
      style={[
        styles.toast,
        { bottom: insets.bottom + 72, backgroundColor: colors.raised, borderColor: colors.border },
      ]}
      testID="undo-toast"
    >
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {toast.title}
      </Text>
      <Pressable
        onPress={() => {
          setToast(null);
          void operations.undo(toast.action);
        }}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityHint="Restores the conversations to their previous folders"
      >
        <Text style={[styles.undo, { color: colors.text }]}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: { fontSize: 15, flex: 1 },
  undo: { fontSize: 17, fontWeight: "600" },
});
