import { StyleSheet, View } from "react-native";

import { alpha, useTheme } from "../theme.ts";

/** The hairline between rows (Design.swift's `hairline`), from `inset` to the edge. */
export function Separator({ inset = 0 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        marginLeft: inset,
        backgroundColor: alpha(theme.colors.border, 0.7),
      }}
    />
  );
}
