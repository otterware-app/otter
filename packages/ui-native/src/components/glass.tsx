import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useReduceTransparency } from "../accessibility.ts";
import { alpha, useTheme } from "../theme.ts";

export type GlassShape = "capsule" | "circle" | { radius: number };

export type GlassProps = {
  shape?: GlassShape;
  /** Reacts to touch, as `.glassEffect(.regular.interactive())`: for a control. */
  interactive?: boolean;
  /** A tint over the glass, as `.glassProminent` with `.tint(…)`. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const liquidGlass = isLiquidGlassAvailable();

/**
 * Liquid Glass in a shape. With Reduce Transparency on, it's a solid surface with a hairline
 * edge, as the system draws its own glass then.
 */
export function Glass({
  shape = "capsule",
  interactive = false,
  tint,
  style,
  children,
}: GlassProps) {
  const theme = useTheme();
  const reduceTransparency = useReduceTransparency();
  const radius = typeof shape === "object" ? shape.radius : 9999;
  const shaped = { borderRadius: radius, borderCurve: "continuous" as const };
  if (reduceTransparency || !liquidGlass) {
    return (
      <View
        style={[
          shaped,
          {
            backgroundColor: tint ?? theme.colors.card,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: alpha(theme.colors.foreground, 0.12),
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      tintColor={tint}
      colorScheme={theme.scheme}
      style={[shaped, style]}
    >
      {children}
    </GlassView>
  );
}
