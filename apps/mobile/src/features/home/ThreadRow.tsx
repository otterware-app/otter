import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import { decodeEntities } from "@otter-mail/client-runtime/text";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { relativeDate, usePalette } from "../theme";
import { SenderAvatar } from "./SenderAvatar";

const isDraft = (row: MessageSummary) => (row.threadLabelIds ?? row.labelIds).includes("DRAFT");

/** What VoiceOver reads for a row: state first, then who, what and when. */
export function rowLabel(row: MessageSummary): string {
  const unread = row.threadUnread ?? row.unread;
  const starred = row.threadStarred ?? row.starred;
  return [
    unread ? "Unread" : null,
    starred ? "Starred" : null,
    isDraft(row) ? "Draft" : null,
    row.fromName || row.fromEmail,
    row.subject || "No subject",
    decodeEntities(row.snippet).slice(0, 140),
    row.hasAttachments ? "Has attachments" : null,
    row.threadCount && row.threadCount > 1 ? `${row.threadCount} messages` : null,
    relativeDate(row.date),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * apps/ios's ThreadRow: the sender's picture (new mail's dot in the gutter
 * before it), then who and when, the subject, and a line of the latest
 * message. Unread is the dot, a brighter medium-weight name and a soft card;
 * read mail recedes to grey.
 */
export const ThreadRow = memo(function ThreadRow({
  row,
  accountId,
  onOpen,
  onLongPress,
  fullWidth = false,
  flags = false,
  selected,
}: {
  row: MessageSummary;
  accountId: string;
  /** The desktop's full-width rows: edge to edge with a hairline between, instead of cards. */
  fullWidth?: boolean;
  onOpen?: (row: MessageSummary) => void;
  onLongPress?: (row: MessageSummary) => void;
  /** Outlook's and IMAP's flags instead of Gmail's stars. */
  flags?: boolean;
  /** Selecting (More › Select messages): whether this one is picked. */
  selected?: boolean;
}) {
  const colors = usePalette();
  const unread = row.threadUnread ?? row.unread;
  const starred = row.threadStarred ?? row.starred;
  const draft = isDraft(row);
  const count = row.threadCount ?? 1;
  return (
    <Pressable
      onPress={() => onOpen?.(row)}
      onLongPress={() => onLongPress?.(row)}
      accessibilityRole="button"
      accessibilityLabel={rowLabel(row)}
      accessibilityHint={selected === undefined ? "Opens the conversation" : undefined}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [
        styles.row,
        fullWidth && [styles.fullWidth, { borderBottomColor: colors.border }],
        {
          backgroundColor: pressed
            ? colors.pressed
            : unread && !draft
              ? colors.unreadCard
              : "transparent",
        },
      ]}
      testID={`thread-${row.threadId}`}
    >
      {selected !== undefined ? (
        <View style={styles.check}>
          <SymbolView
            name={selected ? "checkmark.circle.fill" : "circle"}
            size={22}
            tintColor={selected ? colors.accent : colors.secondary}
          />
        </View>
      ) : null}
      <View style={styles.avatar}>
        {unread ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
        <SenderAvatar
          accountId={row.accountId ?? accountId}
          email={row.fromEmail}
          name={row.fromName}
        />
      </View>
      <View style={styles.lines}>
        <View style={styles.top}>
          <Text
            numberOfLines={1}
            style={[
              styles.text,
              styles.from,
              { color: unread ? colors.text : colors.readText, fontWeight: unread ? "500" : "400" },
            ]}
          >
            {row.fromName || row.fromEmail || "Draft"}
          </Text>
          {starred ? (
            <SymbolView
              name={flags ? "flag.fill" : "star.fill"}
              size={11}
              tintColor={colors.star}
            />
          ) : null}
          {row.hasAttachments ? (
            <SymbolView name="paperclip" size={11} tintColor={colors.secondary} />
          ) : null}
          {count > 1 ? (
            <Text style={[styles.meta, { color: colors.secondary }]}>{count}</Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.secondary }]}>{relativeDate(row.date)}</Text>
        </View>
        <Text
          numberOfLines={1}
          style={[styles.text, { color: unread ? colors.text : colors.readSubject }]}
        >
          {row.subject || "(no subject)"}
        </Text>
        <Text numberOfLines={1} style={[styles.text, { color: colors.snippet }]}>
          {draft ? `Draft · ${decodeEntities(row.snippet)}` : decodeEntities(row.snippet)}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 10,
    marginHorizontal: 4,
    marginVertical: 1,
    borderRadius: 8,
  },
  fullWidth: {
    marginHorizontal: 0,
    marginVertical: 0,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { paddingTop: 2 },
  check: { alignSelf: "center", marginLeft: -4 },
  dot: { position: "absolute", left: -13, top: 2 + 15, width: 6, height: 6, borderRadius: 3 },
  lines: { flex: 1, gap: 2 },
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontSize: 15 },
  from: { flex: 1, marginRight: 2 },
  meta: { fontSize: 13, fontVariant: ["tabular-nums"] },
});
