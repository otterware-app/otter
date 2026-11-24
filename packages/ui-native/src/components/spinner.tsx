import { ActivityIndicator } from "react-native";

import { useTheme, type ColorToken } from "../theme.ts";

/** The system's activity indicator; `mini` is SwiftUI's `.controlSize(.mini)`, for a row's status. */
export function Spinner({
  size = "small",
  color = "mutedForeground",
}: {
  size?: "mini" | "small" | "large";
  color?: ColorToken;
}) {
  const theme = useTheme();
  return (
    <ActivityIndicator
      size={size === "large" ? "large" : "small"}
      color={theme.colors[color]}
      style={size === "mini" && { transform: [{ scale: 0.7 }] }}
      accessibilityLabel="Loading"
    />
  );
}
