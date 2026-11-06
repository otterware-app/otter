import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import type { RootStack } from "../../App";
import { mailboxes } from "../../state/client";
import { core } from "../../state/core";
import { palette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Welcome">;

/**
 * Adding a mailbox, as the Swift app's WelcomeView: Google and Microsoft sign in
 * natively (a browser sheet; the refresh token goes straight to the
 * Keychain), any other provider over IMAP with its password.
 */
export function WelcomeScreen({ navigation }: Props) {
  const colors = palette(useColorScheme());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (kind: string, channel: string) => {
    setBusy(kind);
    setError(null);
    try {
      const added = await core.invoke(channel);
      if (added !== null) {
        await mailboxes.refreshAccounts();
        navigation.goBack();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(message)) setError(message);
    } finally {
      setBusy(null);
    }
  };

  const option = (kind: string, symbol: SFSymbol, title: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={busy !== null}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: pressed ? colors.pressed : colors.card },
      ]}
      accessibilityRole="button"
      testID={`add-${kind}`}
    >
      <SymbolView name={symbol} size={22} tintColor={colors.text} />
      <Text style={[styles.optionTitle, { color: colors.text }]}>{title}</Text>
      {busy === kind ? (
        <ActivityIndicator />
      ) : (
        <SymbolView name="chevron.right" size={14} tintColor={colors.secondary} />
      )}
    </Pressable>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Add a mailbox</Text>
      <Text style={[styles.lead, { color: colors.secondary }]}>
        Otter Mail talks to your mail provider directly from this iPhone.
      </Text>
      <View style={styles.options}>
        {option("google", "envelope", "Gmail", () => void add("google", "gmail:addAccount"))}
        {option(
          "outlook",
          "envelope.badge",
          "Outlook",
          () => void add("outlook", "gmail:addOutlookAccount"),
        )}
        {option("imap", "server.rack", "Other mail (IMAP)", () => navigation.navigate("AddImap"))}
      </View>
      {error ? <Text style={[styles.error, { color: colors.trash }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: "700", marginTop: 12 },
  lead: { fontSize: 16, marginTop: 8, lineHeight: 22 },
  options: { marginTop: 28, gap: 10 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 18 },
  optionTitle: { flex: 1, fontSize: 17, fontWeight: "500" },
  error: { marginTop: 18, fontSize: 14 },
});
