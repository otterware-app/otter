import { RegistryContext } from "@effect/atom-react";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AddImapScreen } from "./features/accounts/AddImapScreen";
import { WelcomeScreen } from "./features/accounts/WelcomeScreen";
import { ChatScreen, type ChatHandoff } from "./features/chat/ChatScreen";
import { ComposeScreen } from "./features/compose/ComposeScreen";
import { GateScreen } from "./features/gate/GateScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { SearchScreen } from "./features/search/SearchScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { usePalette, useThemeSource } from "./features/theme";
import { ThreadScreen } from "./features/thread/ThreadScreen";
import { startAgents } from "./state/chats";
import { appAtomRegistry, startClientState } from "./state/client";
import { developmentVariant } from "./state/core";
import { startUiPreferences } from "./state/preferences";

const COMPOSE_TITLES = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply All",
  forward: "Forward",
} as const;
export type RootStack = {
  Home: undefined;
  Thread: { accountId: string; threadId: string; subject: string; labelId?: string };
  Search: { accountId: string };
  Settings: undefined;
  Welcome: undefined;
  AddImap: undefined;
  Chat: { context?: ChatHandoff } | undefined;
  Compose: {
    accountId: string;
    mode?: "new" | "reply" | "replyAll" | "forward";
    messageId?: string;
    threadId?: string;
  };
  Gate: { run?: string; n?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const homeOptions: NativeStackNavigationOptions = {
  headerTransparent: true,
};

const linking = {
  prefixes: ["ottermail://", "ottermail-dev://", "ottermail-preview://"],
  config: {
    screens: {
      Home: "",
      Thread: "thread",
      Settings: "settings",
      ...(developmentVariant ? { Gate: "gate" } : {}),
    },
  },
};

export default function App() {
  useEffect(() => {
    startClientState();
    startUiPreferences();
    return startAgents();
  }, []);
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <SafeAreaProvider>
        <Navigation />
      </SafeAreaProvider>
    </RegistryContext.Provider>
  );
}

/** The screens, in the account's theme (Settings → Appearance). */
function Navigation() {
  useThemeSource();
  const colors = usePalette();
  const theme = useMemo(() => {
    const base = colors.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.canvas,
        card: colors.canvas,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [colors]);
  return (
    <NavigationContainer theme={theme} linking={linking}>
      <StatusBar style={colors.dark ? "light" : "dark"} />
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={homeOptions} />
        <Stack.Screen
          name="Thread"
          component={ThreadScreen}
          options={{ title: "", headerTransparent: true }}
        />
        <Stack.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: "Search", presentation: "modal" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="Welcome"
          component={WelcomeScreen}
          options={{ title: "", presentation: "modal" }}
        />
        <Stack.Screen name="AddImap" component={AddImapScreen} options={{ title: "Other mail" }} />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={{
            title: "Agent",
            presentation: "formSheet",
            sheetAllowedDetents: [0.6, 1],
            sheetGrabberVisible: true,
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
        <Stack.Screen
          name="Compose"
          component={ComposeScreen}
          options={({ route }) => ({
            title: COMPOSE_TITLES[route.params.mode ?? "new"],
            presentation: "modal",
          })}
        />
        {developmentVariant ? (
          <Stack.Screen name="Gate" component={GateScreen} options={{ title: "Phase 0 gate" }} />
        ) : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
