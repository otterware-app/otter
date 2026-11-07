import { GlassView } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { GLASS_AVAILABLE, useReduceTransparency } from "./glass";
import { usePalette } from "./theme";

/**
 * Glass under React Native content that can't move into SwiftUI (a text
 * field): UIKit's Liquid Glass, not interactive, so typing doesn't wobble it;
 * an opaque surface without glass or with Reduce Transparency.
 */
export function GlassPanel({
  style,
  children,
}: {
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const colors = usePalette();
  const solid = useReduceTransparency();
  if (GLASS_AVAILABLE && !solid) {
    return (
      <GlassView style={style} glassEffectStyle="regular">
        {children}
      </GlassView>
    );
  }
  return (
    <View
      style={[
        style,
        {
          backgroundColor: colors.raised,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {children}
    </View>
  );
}
