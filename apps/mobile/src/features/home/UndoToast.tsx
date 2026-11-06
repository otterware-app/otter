import { onUndoableAction, type UndoAction } from "@otter-mail/client-runtime/operations";
import { GlassView } from "expo-glass-effect";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { operations } from "../../state/client";
import { palette } from "../theme";

/** "Archived · Undo", over the places bar, for a few seconds after each undoable action. */
export function UndoToast() {
  const colors = palette(useColorScheme());
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ title: string; action: UndoAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      onUndoableAction((title, action) => {
        setToast({ title, action });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(null), 4500);
      }),
    [],
  );

  if (!toast) return null;
  return (
    <GlassView
      style={[styles.toast, { bottom: insets.bottom + 72 }]}
      glassEffectStyle="regular"
      testID="undo-toast"
    >
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {toast.title}
      </Text>
      <Pressable
        onPress={() => {
          setToast(null);
          void operations.undo(toast.action);
        }}
        hitSlop={10}
        accessibilityRole="button"
      >
        <Text style={[styles.undo, { color: colors.accent }]}>Undo</Text>
      </Pressable>
    </GlassView>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 20,
    right: 20,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 15, fontWeight: "500", flex: 1 },
  undo: { fontSize: 15, fontWeight: "600", marginLeft: 12 },
});
