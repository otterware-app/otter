import { useAtomValue } from "@effect/atom-react";
import { Button, Ellipse, HStack, Text } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text as RNText, View } from "react-native";

import { mailboxes, type Mailbox } from "../../state/client";
import {
  cancelled,
  signedOutTitle,
  signInAgain,
  signInWithPassword,
} from "../../state/mailbox-sign-in";
import { inDemo } from "../../state/otter";
import { lostSignIn, syncLine, syncNow, useSyncHealth } from "../../state/sync-health";
import type { Palette } from "../theme";

const failed = (e: unknown) =>
  cancelled(e) ? null : Alert.alert("Couldn't sign in", e instanceof Error ? e.message : String(e));

/** SignInAgainButton: Google or Microsoft again, or the IMAP password asked for in an alert. */
export function signInAgainFlow(mailbox: Mailbox): void {
  if (mailbox.provider !== "imap") {
    void signInAgain(mailbox).catch(failed);
    return;
  }
  Alert.prompt(
    `Password for ${mailbox.email}`,
    mailbox.imap
      ? `It stays on this iPhone; your mail goes straight to ${mailbox.imap.imap.host}.`
      : "",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign in",
        onPress: (password?: string) =>
          void signInWithPassword(mailbox, password ?? "").catch(failed),
      },
    ],
    "secure-text",
  );
}

/** SignedOutBanners: over the list, each shown mailbox that lost its sign-in, until closed. */
export function SignedOutBanners({ colors }: { colors: Palette }) {
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const health = useSyncHealth(inDemo ? [] : accounts.map((m) => m.id));
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const lost = accounts.filter((m) => lostSignIn(m, health[m.id]) && !closed.has(m.id));
  if (lost.length === 0) return null;
  return (
    <View style={styles.banners}>
      {lost.map((mailbox) => (
        <View
          key={mailbox.id}
          style={[styles.banner, { backgroundColor: colors.raised, borderColor: colors.border }]}
        >
          <SymbolView name="exclamationmark.triangle.fill" size={16} tintColor={colors.warning} />
          <RNText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {signedOutTitle(mailbox)}
          </RNText>
          <Pressable
            onPress={() => signInAgainFlow(mailbox)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <RNText style={[styles.action, { color: colors.focus }]}>
              {mailbox.provider === "imap" ? "Enter password" : "Sign in"}
            </RNText>
          </Pressable>
          <Pressable
            onPress={() => setClosed(new Set([...closed, mailbox.id]))}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <SymbolView name="xmark" size={12} weight="semibold" tintColor={colors.secondary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/** SyncStatusLine, under the places panel: when the mailbox last synced, or why it failed. Tap syncs. */
export function SyncStatusLine({
  colors,
  mailbox,
}: {
  colors: Palette;
  mailbox: Mailbox | undefined;
}) {
  const health = useSyncHealth(mailbox && !inDemo && !mailbox.signedOut ? [mailbox.id] : []);
  if (!mailbox || inDemo || mailbox.signedOut) return null;
  const { text, warning } = syncLine(health[mailbox.id]);
  return (
    <Button
      onPress={() => void syncNow(mailbox.id)}
      modifiers={[buttonStyle("plain"), accessibilityHint("Syncs now")]}
    >
      <HStack
        spacing={6}
        modifiers={[
          padding({ horizontal: 12, top: 8, bottom: 4 }),
          frame({ maxWidth: Infinity, alignment: "leading" }),
          contentShape(shapes.rectangle()),
        ]}
      >
        {warning ? (
          <Ellipse modifiers={[foregroundStyle(colors.warning), frame({ width: 6, height: 6 })]} />
        ) : null}
        <Text
          modifiers={[
            font({ textStyle: "footnote" }),
            foregroundStyle(warning ? colors.text : colors.secondary),
            lineLimit(1),
          ]}
        >
          {text}
        </Text>
      </HStack>
    </Button>
  );
}

const styles = StyleSheet.create({
  banners: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 15 },
  action: { fontSize: 15, fontWeight: "600" },
});
