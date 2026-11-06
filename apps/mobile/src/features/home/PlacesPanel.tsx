import type { MailLabel } from "@otter-mail/client-runtime/mail";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Mailbox } from "../../state/client";
import { usePalette } from "../theme";
import { MailboxAvatar } from "./PlacesBar";
import { folders, ownLabels, placeCount, placeSymbol, placeTitle } from "./places";

/**
 * apps/ios's PlacesPanel: the mailbox, its folders with their counts, its own
 * labels (folders, for Outlook and IMAP), then Search and Settings. It opens
 * out of the places bar's glass.
 */
export function PlacesPanel({
  mailbox,
  labels,
  labelId,
  onPlace,
  onSearch,
  onSettings,
}: {
  mailbox: Mailbox | undefined;
  labels: readonly MailLabel[];
  labelId: string;
  onPlace: (labelId: string) => void;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const colors = usePalette();
  const own = ownLabels(labels);
  const insets = useSafeAreaInsets();
  const maxHeight = Math.min(560, useWindowDimensions().height - insets.top - insets.bottom - 120);

  const row = (
    key: string,
    title: string,
    symbol: SFSymbol,
    onPress: () => void,
    {
      selected = false,
      count = 0,
      depth = 0,
      tint,
    }: { selected?: boolean; count?: number; depth?: number; tint?: string } = {},
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `${title}, ${count}` : title}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: 12 + depth * 20 },
        (pressed || selected) && { backgroundColor: colors.selected },
      ]}
      testID={`place-${key}`}
    >
      <View style={styles.icon}>
        <SymbolView name={symbol} size={17} tintColor={tint ?? colors.text} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {count > 0 ? <Text style={[styles.count, { color: colors.secondary }]}>{count}</Text> : null}
    </Pressable>
  );

  return (
    <View style={[styles.panel, { maxHeight }]}>
      <View style={styles.header}>
        <MailboxAvatar mailbox={mailbox} size={24} />
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {mailbox?.displayName ?? mailbox?.name ?? mailbox?.email ?? "Mailbox"}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        {folders(labels).map((label) =>
          row(
            label.id,
            placeTitle(label.id, labels),
            placeSymbol(label.id),
            () => onPlace(label.id),
            {
              selected: label.id === labelId,
              count: placeCount(label),
            },
          ),
        )}
        {own.length > 0 ? (
          <>
            <Text style={[styles.section, { color: colors.secondary }]} accessibilityRole="header">
              {mailbox?.provider === "gmail" || !mailbox?.provider ? "Labels" : "Folders"}
            </Text>
            {own.map(({ label, name, depth }) =>
              row(label.id, name, "tag", () => onPlace(label.id), {
                selected: label.id === labelId,
                count: placeCount(label),
                depth,
                tint: label.color?.backgroundColor,
              }),
            )}
            <View style={[styles.divider, styles.inner, { backgroundColor: colors.border }]} />
          </>
        ) : null}
        {row("search", "Search", "magnifyingglass", onSearch)}
        {row("settings", "Settings", "gearshape", onSettings)}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: "100%", borderRadius: 32, overflow: "hidden" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    height: 56,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 12 },
  inner: { marginVertical: 6, marginHorizontal: 4 },
  content: { padding: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingRight: 12,
    minHeight: 48,
    borderRadius: 16,
  },
  icon: { width: 24, alignItems: "center" },
  title: { flex: 1, fontSize: 17 },
  count: { fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] },
  section: { fontSize: 13, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
});
