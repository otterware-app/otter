import {
  copyText,
  htmlToText,
  useColors,
  type MessageCardProps,
  type MobileExtension,
} from "@otter-mail/mobile/extension-kit";
import { findVerificationCode } from "@otter-mail/shared/verification-code";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { manifest } from "../manifest";

function SignInCodeCard({ summary, detail, onTrash }: MessageCardProps) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  const code = useMemo(
    () =>
      findVerificationCode(
        summary.subject,
        detail.bodyText ?? (detail.bodyHtml ? htmlToText(detail.bodyHtml) : ""),
      ),
    [detail, summary.subject],
  );
  if (!code) return null;

  const copy = async () => {
    await copyText(code);
    setCopied(true);
    setTimeout(() => onTrash?.(), 600);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]} testID="sign-in-code">
      <View style={styles.text}>
        <Text style={[styles.label, { color: colors.secondary }]}>Verification code</Text>
        <Text style={[styles.code, { color: colors.text }]} selectable>
          {code}
        </Text>
      </View>
      <Pressable
        onPress={() => void copy()}
        style={[styles.button, { backgroundColor: colors.accent }]}
        accessibilityRole="button"
      >
        <Text style={styles.buttonTitle}>
          {copied ? "Copied" : onTrash ? "Copy & Trash" : "Copy"}
        </Text>
      </Pressable>
    </View>
  );
}

export default {
  manifest,
  messageCards: [SignInCodeCard],
} satisfies MobileExtension;

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 18 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 13 },
  code: { fontSize: 24, fontWeight: "700", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  button: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  buttonTitle: { color: "#FFFFFF", fontWeight: "600" },
});
