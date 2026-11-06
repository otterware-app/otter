import { RegistryProvider } from "@effect/atom-react";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { GateScreen } from "./features/gate/GateScreen";
import { GateButton, InboxScreen } from "./features/inbox/InboxScreen";
import { ThreadScreen } from "./features/thread/ThreadScreen";

export type RootStack = {
  Inbox: undefined;
  Thread: { accountId: string; threadId: string; subject: string };
  Gate: { run?: string; n?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const inboxOptions = ({
  navigation,
}: NativeStackScreenProps<RootStack, "Inbox">): NativeStackNavigationOptions => ({
  title: "Inbox",
  headerLargeTitle: true,
  headerTransparent: true,
  headerRight: () => <GateButton onPress={() => navigation.navigate("Gate")} />,
});

const linking = {
  prefixes: ["ottermail://", "ottermail-dev://", "ottermail-preview://"],
  config: { screens: { Inbox: "", Thread: "thread", Gate: "gate" } },
};

export default function App() {
  const dark = useColorScheme() === "dark";
  return (
    <RegistryProvider>
      <SafeAreaProvider>
        <NavigationContainer theme={dark ? DarkTheme : DefaultTheme} linking={linking}>
          <StatusBar />
          <Stack.Navigator>
            <Stack.Screen name="Inbox" component={InboxScreen} options={inboxOptions} />
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
