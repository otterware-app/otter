import { ActivityIndicator } from "react-native";

import { useTheme } from "../theme.ts";

/** The system's activity indicator; `mini` is SwiftUI's `.controlSize(.mini)`, for a row's status. */
export function Spinner({ size = "small" }: { size?: "mini" | "small" | "large" }) {
  const theme = useTheme();
  return (
    <ActivityIndicator
      size={size === "large" ? "large" : "small"}
      color={theme.colors.mutedForeground}
      style={size === "mini" && { transform: [{ scale: 0.7 }] }}
      accessibilityLabel="Loading"
    />
  );
}
