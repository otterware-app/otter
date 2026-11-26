import { startSyncedPreferences } from "@otter/client/preferences";
import { useExternalMailChanges, useWriteFailureToasts } from "@otter/client/mail/hooks";
import { Spinner } from "@otter/ui-native/components/spinner";
import { useTheme } from "@otter/ui-native/theme";
import * as Sentry from "@sentry/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Suspense, use, useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { coreStarted } from "../core.ts";
import { MailNotices } from "../frame/mail-notices.tsx";
import { useFollowTranslationSettings } from "../mail/translation.ts";
import { useMailNotifications } from "../notifications/use-mail-notifications.ts";
import { followColorScheme } from "../settings/preferences.ts";

export { ErrorBoundary } from "expo-router";

const queries = new QueryClient();

// What was touched, as breadcrumbs for error reports.
export default Sentry.wrap(RootLayout);

function RootLayout() {
  const theme = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <QueryClientProvider client={queries}>
        <Suspense
          fallback={
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Spinner />
            </View>
          }
        >
          <MailStack />
        </Suspense>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

function MailStack() {
  use(coreStarted);
  const theme = useTheme();
  useExternalMailChanges();
  useFollowTranslationSettings();
  useMailNotifications();
  useWriteFailureToasts();
  useEffect(() => followColorScheme(), []);
  useEffect(() => startSyncedPreferences(), []);
  return (
    <ThemeProvider value={theme.scheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar />
      <Stack
        screenOptions={{
          headerTintColor: theme.colors.foreground,
          headerStyle: { backgroundColor: theme.colors.canvas },
          contentStyle: { backgroundColor: theme.colors.canvas },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="mail/[account]/[label]/index" options={{ headerShown: false }} />
        <Stack.Screen name="mail/[account]/[label]/[thread]" />
        <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
        <Stack.Screen name="compose" options={{ presentation: "modal", title: "New message" }} />
        <Stack.Screen name="settings" options={{ presentation: "modal", headerShown: false }} />
      </Stack>
      <MailNotices />
    </ThemeProvider>
  );
}
