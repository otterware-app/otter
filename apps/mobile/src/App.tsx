import { RegistryContext } from "@effect/atom-react";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AddImapScreen } from "./features/accounts/AddImapScreen";
import { WelcomeScreen } from "./features/accounts/WelcomeScreen";
import { ChatScreen } from "./features/chat/ChatScreen";
import { GateScreen } from "./features/gate/GateScreen";
import { HomeScreen } from "./features/home/HomeScreen";
import { PlacesScreen } from "./features/home/PlacesScreen";
import { SearchScreen } from "./features/search/SearchScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { ThreadScreen } from "./features/thread/ThreadScreen";
import { appAtomRegistry, startClientState } from "./state/client";

export type RootStack = {
  Home: undefined;
  Thread: { accountId: string; threadId: string; subject: string; labelId?: string };
  Search: { accountId: string };
  Places: { accountId: string };
  Settings: undefined;
  Welcome: undefined;
  AddImap: undefined;
  Chat: undefined;
  Gate: { run?: string; n?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const homeOptions: NativeStackNavigationOptions = {
  headerLargeTitle: true,
  headerTransparent: true,
};

const linking = {
  prefixes: ["ottermail://", "ottermail-dev://", "ottermail-preview://"],
  config: { screens: { Home: "", Thread: "thread", Gate: "gate", Settings: "settings" } },
};

export default function App() {
  const dark = useColorScheme() === "dark";
  useEffect(startClientState, []);
  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <SafeAreaProvider>
        <NavigationContainer theme={dark ? DarkTheme : DefaultTheme} linking={linking}>
          <StatusBar />
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} options={homeOptions} />
            <Stack.Screen
              name="Thread"
              component={ThreadScreen}
              options={{ title: "", headerTransparent: true }}
            />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Search" }} />
            <Stack.Screen
              name="Places"
              component={PlacesScreen}
              options={{
                title: "Places",
                presentation: "formSheet",
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
              }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: "Settings", presentation: "modal" }}
            />
            <Stack.Screen
              name="Welcome"
              component={WelcomeScreen}
              options={{ title: "", presentation: "modal" }}
            />
            <Stack.Screen
              name="AddImap"
              component={AddImapScreen}
              options={{ title: "Other mail" }}
            />
            <Stack.Screen
              name="Chat"
              component={ChatScreen}
              options={{ title: "Agent", presentation: "modal" }}
            />
            <Stack.Screen name="Gate" component={GateScreen} options={{ title: "Phase 0 gate" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </RegistryContext.Provider>
  );
}
