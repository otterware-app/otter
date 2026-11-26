import { useChatEvents } from "@otter/client/agents/chat-store";
import { useOtterAccount } from "@otter/client/otter-account";
import { startSyncedPreferences } from "@otter/client/preferences";
import { Spinner } from "@otter/ui-native/components/spinner";
import { useTheme } from "@otter/ui-native/theme";
import * as Sentry from "@sentry/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Suspense, use, useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { FullWindowOverlay } from "react-native-screens";

import { DEV_TOOLS, coreStarted } from "../core.ts";
import { useFollowNavigation } from "../frame/navigation.ts";
import { Notices } from "../frame/notices.tsx";
import { useStackOptions } from "../frame/stack-options.ts";
import { followSchemePreference } from "../frame/theme-preference.ts";
import { AgentNotificationDevice, useFollowAgentNotifications } from "../notifications/follow.ts";

export { ErrorBoundary } from "expo-router";

const queryClient = new QueryClient();

// What was touched, as breadcrumbs for error reports.
export default Sentry.wrap(RootLayout);

function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<Starting />}>
            <Started>
              <App />
            </Started>
          </Suspense>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function Started({ children }: { children: ReactNode }) {
  use(coreStarted);
  return children;
}

function Starting() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.colors.canvas }}>
      <Spinner />
    </View>
  );
}

/** Follows core: the chats' events, the synced preferences and the color scheme they choose. */
function useFollowCore() {
  useFollowNavigation();
  useChatEvents();
  useEffect(() => startSyncedPreferences(), []);
  useEffect(() => followSchemePreference(), []);
}

/** Signed out of Otter, the welcome alone; signed in, the tabs. */
function App() {
  useFollowCore();
  const theme = useTheme();
  const account = useOtterAccount();
  useFollowAgentNotifications(account === null ? undefined : (account.user?.id ?? null));
  const stack = useStackOptions();
  const base = theme.scheme === "dark" ? DarkTheme : DefaultTheme;
  if (!account) return <Starting />;
  const signedIn = Boolean(account.user);
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: theme.colors.primary,
          background: theme.colors.canvas,
          card: theme.colors.canvas,
          text: theme.colors.foreground,
          border: theme.colors.border,
          notification: theme.colors.primary,
        },
      }}
    >
      <StatusBar />
      <Stack screenOptions={{ ...stack, headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={DEV_TOOLS && signedIn}>
          <Stack.Screen name="self-test" options={{ headerShown: true, title: "Self-test" }} />
          <Stack.Screen name="gallery" options={{ headerShown: true, title: "Components" }} />
        </Stack.Protected>
      </Stack>
      {account.user ? (
        <AgentNotificationDevice key={account.user.id} userId={account.user.id} />
      ) : null}
      <FullWindowOverlay>
        <Notices />
      </FullWindowOverlay>
    </ThemeProvider>
  );
}
