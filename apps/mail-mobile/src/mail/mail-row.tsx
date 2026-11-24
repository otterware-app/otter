import { formatRelativeDate } from "@otter/client/mail/format";
import type { MessageSummary } from "@otter/client/mail/types";
import { Avatar } from "@otter/ui-native/components/avatar";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

export function MailRow({
  message,
  account,
  label,
}: {
  message: MessageSummary;
  account: string;
  label: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const unread = message.threadUnread ?? message.unread;
  const from = message.fromName || message.fromEmail;
  const subject = message.subject || "(No subject)";
  const initial = Array.from(from.trim())[0]?.toLocaleUpperCase() ?? "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[unread ? "Unread" : "", from, subject, message.snippet]
        .filter(Boolean)
        .join(", ")}
      onPress={() =>
        router.push({
          pathname: "/mail/[account]/[label]/[thread]",
          params: { account, label, thread: message.threadId },
        })
      }
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.colors.card : theme.colors.canvas },
      ]}
    >
      <View style={styles.avatar}>
        {unread ? <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} /> : null}
        <Avatar size={36} initials={initial} />
      </View>
      <View style={[styles.lines, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.top}>
          <Text
            style={styles.sender}
            size="md"
            weight={unread ? "medium" : "regular"}
            color={unread ? "foreground" : "mutedForeground"}
            numberOfLines={1}
          >
            {from}
          </Text>
          {(message.threadStarred ?? message.starred) ? (
            <Icon name="star.fill" size={11} color="primary" />
          ) : null}
          {message.hasAttachments ? (
            <Icon name="paperclip" size={11} color="mutedForeground" />
          ) : null}
          {(message.threadCount ?? 0) > 1 ? (
            <Text size="sm" color="mutedForeground">
              {message.threadCount}
            </Text>
          ) : null}
          <Text size="sm" color="mutedForeground">
            {formatRelativeDate(message.date)}
          </Text>
        </View>
        <Text size="md" color={unread ? "foreground" : "mutedForeground"} numberOfLines={1}>
          {subject}
        </Text>
        {message.snippet ? (
          <Text size="sm" color="mutedForeground" numberOfLines={1}>
            {message.snippet}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 20 },
  avatar: { paddingTop: 13 },
  dot: { width: 6, height: 6, borderRadius: 3, position: "absolute", left: -12, top: 28 },
  lines: { flex: 1, gap: 2, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  sender: { flex: 1 },
});
