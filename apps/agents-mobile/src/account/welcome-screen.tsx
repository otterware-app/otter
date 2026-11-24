import { otterApi } from "@otter/client/otter-account";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { useTheme, type ColorToken } from "@otter/ui-native/theme";
import { Image } from "expo-image";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import mark from "./otter-mark.png";

/** Signed out (WelcomeView.swift): what the app is, and Sign in with Google. */
export function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const signIn = () => {
    setBusy(true);
    otterApi
      .signIn()
      .catch((error: unknown) =>
        Alert.alert("Couldn't sign in", error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setBusy(false));
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.canvas,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Image
          source={mark}
          accessible={false}
          style={{
            width: 112,
            height: 112,
            borderRadius: 26,
            borderCurve: "continuous",
            marginBottom: 28,
          }}
        />
        <View style={{ flexDirection: "row", gap: 8 }} accessible accessibilityRole="header">
          <Text size="3xl" weight="semibold" style={{ letterSpacing: -0.8 }}>
            Otter
          </Text>
          <Text
            size="3xl"
            weight="semibold"
            color="mutedForeground"
            style={{ letterSpacing: -0.8 }}
          >
            Agents
          </Text>
        </View>
        <Text size="xl" color="mutedForeground" style={{ marginTop: 6 }}>
          Your agents, wherever you are.
        </Text>
      </View>
      <View style={{ paddingHorizontal: 28, gap: 12 }}>
        <WelcomeButton
          title={busy ? "Signing in…" : "Sign in with Google"}
          icon="person.crop.circle"
          prominent
          disabled={busy}
          onPress={signIn}
        />
        {busy ? (
          <WelcomeButton title="Cancel" onPress={() => void otterApi.cancelSignIn()} />
        ) : null}
        <Text size="body" color="mutedForeground" style={{ textAlign: "center", marginTop: 8 }}>
          Chat with the agents on your Otter account: Otter's own, Hermes, OpenClaw and varys. Every
          chat is the same here, on the Mac and on the web.
        </Text>
      </View>
    </View>
  );
}

/** A wide glass button, as the Swift welcome's `.glassProminent` and `.glass` ones. */
function WelcomeButton({
  title,
  icon,
  prominent = false,
  disabled,
  onPress,
}: {
  title: string;
  icon?: "person.crop.circle";
  prominent?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color: ColorToken = prominent ? "primaryForeground" : "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      <Glass
        interactive
        tint={prominent ? theme.colors.primary : undefined}
        style={{
          minHeight: 50,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {icon ? <Icon name={icon} size={17} weight="semibold" color={color} /> : null}
        <Text size="lg" weight="semibold" color={color}>
          {title}
        </Text>
      </Glass>
    </Pressable>
  );
}
