import { RegistryProvider } from "@effect/atom-react";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { GateScreen } from "./features/gate/GateScreen";
import { InboxScreen } from "./features/inbox/InboxScreen";
import { ThreadScreen } from "./features/thread/ThreadScreen";

export type RootStack = {
  Inbox: undefined;
  Thread: { accountId: string; threadId: string; subject: string };
  Gate: { run?: string; n?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const linking = {
  prefixes: [`${String(Constants.expoConfig?.scheme ?? "ottermail")}://`],
  config: { screens: { Inbox: "", Thread: "thread", Gate: "gate" } },
};

export default function App() {
  const dark = useColorScheme() === "dark";
  return (
    <RegistryProvider>
      <SafeAreaProvider>
        <NavigationContainer theme={dark ? DarkTheme : DefaultTheme} linking={linking}>
          <StatusBar style="auto" />
          <Stack.Navigator>
            <Stack.Screen
              name="Inbox"
              component={InboxScreen}
              options={{ title: "Inbox", headerLargeTitle: true, headerTransparent: true }}
            />
            <Stack.Screen
              name="Thread"
              component={ThreadScreen}
              options={({ route }) => ({ title: route.params.subject, headerTransparent: true })}
            />
            <Stack.Screen name="Gate" component={GateScreen} options={{ title: "Phase 0 gate" }} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </RegistryProvider>
  );
}
