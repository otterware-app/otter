import { EmptyState } from "@otter/ui-native/components/empty-state";
import { useTheme } from "@otter/ui-native/theme";
import { View } from "react-native";

/** Signed out (WelcomeView.swift): what the app is, Sign in with Google, and the demo. */
export function WelcomeScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.colors.canvas }}>
      <EmptyState
        title="Otter Agents"
        description="Sign in with Google, or try the demo, goes here."
      />
    </View>
  );
}
