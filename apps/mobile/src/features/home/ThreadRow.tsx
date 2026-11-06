import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import { decodeEntities } from "@otter-mail/client-runtime/text";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { palette, relativeDate } from "../theme";

/**
 * apps/ios's ThreadRow: who and when, the subject, a line of the latest
 * message; unread mail on a soft card, read mail flat.
 */
export const ThreadRow = memo(function ThreadRow({
  row,
  onOpen,
  onLongPress,
}: {
  row: MessageSummary;
  onOpen?: (row: MessageSummary) => void;
  onLongPress?: (row: MessageSummary) => void;
}) {
  const colors = palette(useColorScheme());
  const unread = row.threadUnread ?? row.unread;
  const starred = row.threadStarred ?? row.starred;
  return (
    <Pressable
      onPress={() => onOpen?.(row)}
      onLongPress={() => onLongPress?.(row)}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? "Unread, " : ""}${row.fromName || row.fromEmail}, ${row.subject || "no subject"}, ${relativeDate(row.date)}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? colors.pressed
            : unread
              ? colors.unreadCard
              : colors.background,
        },
      ]}
    >
      <View style={styles.top}>
        {unread ? <View style={[styles.dot, { backgroundColor: colors.focus }]} /> : null}
        <Text
          numberOfLines={1}
          style={[styles.from, { color: colors.text, fontWeight: unread ? "700" : "500" }]}
        >
          {row.fromName || row.fromEmail}
          {row.threadCount && row.threadCount > 1 ? (
            <Text style={{ color: colors.secondary, fontWeight: "400" }}> {row.threadCount}</Text>
          ) : null}
        </Text>
        {starred ? <SymbolView name="star.fill" size={13} tintColor={colors.star} /> : null}
        {row.hasAttachments ? (
          <SymbolView name="paperclip" size={13} tintColor={colors.secondary} />
        ) : null}
        <Text style={[styles.date, { color: colors.secondary }]}>{relativeDate(row.date)}</Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.subject, { color: colors.text, fontWeight: unread ? "600" : "400" }]}
      >
        {row.subject || "(no subject)"}
      </Text>
      <Text numberOfLines={1} style={[styles.snippet, { color: colors.secondary }]}>
        {decodeEntities(row.snippet)}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 12,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    height: 78,
    marginVertical: 1,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  from: { flex: 1, fontSize: 16 },
  date: { fontSize: 13 },
  subject: { fontSize: 15, marginTop: 1 },
  snippet: { fontSize: 14, marginTop: 1 },
});
