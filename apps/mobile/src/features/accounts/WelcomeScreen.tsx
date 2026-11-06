import { Button, Host, Label, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { storeEnvironment } from "@otter-mail/mobile-account";
import { useEffect, useState } from "react";
import { Alert, Image, StyleSheet, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { developmentVariant } from "../../state/core";
import { cancelled } from "../../state/mailbox-sign-in";
import { setDemo, signInWithGoogle } from "../../state/otter";
import { usePalette } from "../theme";

/**
 * apps/ios's WelcomeView: Sign in with Google adds the Gmail mailbox and signs
 * in to (or creates) the Otter account with it. Outside the App Store
 * (TestFlight, development builds) the demo mailbox can be tried instead.
 */
export function WelcomeScreen() {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [offersDemo, setOffersDemo] = useState(developmentVariant);

  useEffect(() => {
    void storeEnvironment().then(
      (environment) => setOffersDemo(environment !== "Production"),
      () => setOffersDemo(true),
    );
  }, []);

  const signIn = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      if (!cancelled(e)) {
        Alert.alert("Couldn't sign in", e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.canvas, paddingBottom: insets.bottom }]}>
      <View style={styles.hero}>
        <Image
          source={require("../../../assets/otter-mark.png")}
          style={styles.mark}
          accessibilityIgnoresInvertColors
        />
        <RNText style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Otter Mail
        </RNText>
        <RNText style={[styles.lead, { color: colors.secondary }]}>
          A calm, fast Gmail client.
        </RNText>
      </View>
      <Host matchContents={{ vertical: true }} colorScheme={colors.dark ? "dark" : "light"}>
        <VStack spacing={12} modifiers={[padding({ horizontal: 28, bottom: 24 })]}>
          <Button
            onPress={() => void signIn()}
            modifiers={[buttonStyle("glassProminent"), disabled(busy)]}
          >
            <Label
              title={busy ? "Signing in…" : "Sign in with Google"}
              systemImage="person.crop.circle"
              modifiers={[
                font({ textStyle: "headline" }),
                foregroundStyle(colors.actionText),
                frame({ maxWidth: Infinity, minHeight: 34 }),
              ]}
            />
          </Button>
          {offersDemo ? (
            <Button
              onPress={() => setDemo(true)}
              modifiers={[buttonStyle("glass"), disabled(busy)]}
            >
              <Text
                modifiers={[
                  font({ textStyle: "headline" }),
                  foregroundStyle(colors.text),
                  frame({ maxWidth: Infinity, minHeight: 34 }),
                ]}
              >
                Try the demo mailbox
              </Text>
            </Button>
          ) : null}
          <Text
            modifiers={[
              font({ textStyle: "footnote" }),
              foregroundStyle(colors.secondary),
              multilineTextAlignment("center"),
              padding({ top: 8 }),
            ]}
          >
            Your mail goes straight between this iPhone and Gmail. Your mailboxes, themes and
            settings follow your Otter account to the Mac and the web.
          </Text>
        </VStack>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  mark: { width: 112, height: 112, borderRadius: 26, marginBottom: 28 },
  title: { fontSize: 34, fontWeight: "600" },
  lead: { fontSize: 20, marginTop: 6 },
});
