import { useTheme } from "@otter/ui-native/theme";
import { Stack } from "expo-router";

export default function SettingsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.colors.foreground,
        headerStyle: { backgroundColor: theme.colors.canvas },
        contentStyle: { backgroundColor: theme.colors.canvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="mailboxes" options={{ title: "Mailboxes" }} />
      <Stack.Screen name="mailbox" options={{ title: "Mailbox" }} />
      <Stack.Screen name="languages" options={{ title: "Languages I read" }} />
      <Stack.Screen name="licenses" options={{ title: "Open-source licenses" }} />
      <Stack.Screen name="account" options={{ title: "Otter account" }} />
    </Stack>
  );
}
