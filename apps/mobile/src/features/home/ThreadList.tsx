import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { mailboxes, threadLists, type Mailbox } from "../../state/client";
import { core } from "../../state/core";
import { flag, uiPreferencesAtom } from "../../state/preferences";
import { markFirstContent } from "../../state/startup";
import { dayTitle, usePalette } from "../theme";
import { placeSymbol, placeTitle } from "./places";
import { SwipeRow } from "./SwipeRow";
import { threadActions } from "./threadActions";
import { ThreadRow } from "./ThreadRow";

type Item =
  | { type: "pills"; unreadOnly: boolean }
  | {
      type: "day";
      key: string;
      title: string;
      count: number;
      unread: number;
      collapsed: boolean;
      first: boolean;
    }
  | { type: "row"; row: MessageSummary };

const dayKey = (ms: number) => new Date(ms).toDateString();
const isUnread = (row: MessageSummary) => row.threadUnread ?? row.unread;

/**
 * apps/ios's ThreadListView: All and Unread, the conversations grouped by day
 * (a day's heading collapses it), Linear's swipes, pull to refresh, and the
 * next page as the list nears its end.
 */
export function ThreadList({
  mailbox,
  accountId,
  labelId,
  onOpen,
}: {
  mailbox: Mailbox | undefined;
  accountId: string;
  labelId: string;
  onOpen: (row: MessageSummary) => void;
}) {
  const colors = usePalette();
  const ui = useAtomValue(uiPreferencesAtom);
  const byDay = flag(ui, "otter:group-messages-by-day", true);
  const fullWidth = flag(ui, "otter:full-width-rows", false);
  const key = useMemo(() => ({ accountId, labelId }), [accountId, labelId]);
  const view = useAtomValue(threadLists.listAtom(key));
  const labels = useAtomValue(mailboxes.labelsAtom(accountId)).value;
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => {
    const all = view.pages.flatMap((page) => page.messages);
    return unreadOnly ? all.filter(isUnread) : all;
  }, [view.pages, unreadOnly]);

  useEffect(() => threadLists.show(key), [key]);
  useEffect(() => {
    if (rows.length > 0) markFirstContent(rows.length);
  }, [rows.length]);

  const items = useMemo((): Item[] => {
    const out: Item[] = [{ type: "pills", unreadOnly }];
    if (!byDay) return [...out, ...rows.map((row) => ({ type: "row" as const, row }))];
    let day = null as Extract<Item, { type: "day" }> | null;
    for (const row of rows) {
      const k = dayKey(row.date);
      if (day?.key !== k) {
        day = {
          type: "day",
          key: k,
          title: dayTitle(row.date),
          count: 0,
          unread: 0,
          collapsed: collapsed.has(k),
          first: day === null,
        };
        out.push(day);
      }
      day.count++;
      if (isUnread(row)) day.unread++;
      if (!day.collapsed) out.push({ type: "row", row });
    }
    return out;
  }, [rows, byDay, collapsed, unreadOnly]);

  const actions = threadActions(mailbox, labels, labelId);
  const trashLike = labelId === "TRASH" || labelId === "SPAM";

  const refresh = async () => {
    setRefreshing(true);
    try {
      await core.invoke("gmail:syncAccount", { accountId });
    } catch {
      // offline: the list stays as it was
    }
    threadLists.invalidate(accountId);
    void mailboxes.refreshLabels(accountId);
    setRefreshing(false);
  };

  const pill = (title: string, selected: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.pill, selected && { backgroundColor: colors.pill }]}
    >
      <Text style={[styles.pillText, { color: selected ? colors.text : colors.secondary }]}>
        {title}
      </Text>
    </Pressable>
  );

  const renderItem = ({ item }: { item: Item }) => {
    if (item.type === "pills") {
      return (
        <View style={styles.pills} accessibilityRole="tablist">
          {pill("All", !unreadOnly, () => setUnreadOnly(false))}
          {pill("Unread", unreadOnly, () => setUnreadOnly(true))}
        </View>
      );
    }
    if (item.type === "day") {
      return (
        <Pressable
          onPress={() =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(item.key)) next.delete(item.key);
              else next.add(item.key);
              return next;
            })
          }
          style={[styles.day, !item.first && styles.dayGap]}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.count} conversations, ${item.unread} unread`}
          accessibilityValue={{ text: item.collapsed ? "Collapsed" : "Expanded" }}
          accessibilityHint={`Double tap to ${item.collapsed ? "expand" : "collapse"} this day`}
        >
          <SymbolView
            name="chevron.down"
            size={10}
            tintColor={colors.secondary}
            style={{ transform: [{ rotate: item.collapsed ? "-90deg" : "0deg" }] }}
          />
          <Text style={[styles.dayTitle, { color: colors.text }]}>{item.title}</Text>
          <Text style={[styles.dayCount, { color: colors.secondary }]}>
            {item.unread > 0 ? `${item.count} · ${item.unread} unread` : item.count}
          </Text>
        </Pressable>
      );
    }
    const row = item.row;
    return (
      <SwipeRow
        leading={
          actions.canArchive(row) && !trashLike
            ? {
                title: "Archive",
                symbol: "archivebox",
                tint: colors.archive,
                perform: () => actions.archive(row),
              }
            : actions.canMoveToInbox(row) && (trashLike || labelId === "ARCHIVE")
              ? {
                  title: "Inbox",
                  symbol: "tray.and.arrow.down",
                  tint: colors.focus,
                  perform: () => actions.moveToInbox(row),
                }
              : undefined
        }
        trailing={
          trashLike
            ? {
                title: "Delete",
                symbol: "trash",
                tint: colors.trash,
                perform: () => actions.deleteForever(row),
              }
            : {
                title: "Trash",
                symbol: "trash",
                tint: colors.trash,
                perform: () => actions.trash(row),
              }
        }
        actions={actions.accessibilityActions(row)}
        square={fullWidth}
      >
        <ThreadRow
          row={row}
          accountId={accountId}
          onOpen={onOpen}
          onLongPress={actions.showMenu}
          fullWidth={fullWidth}
        />
      </SwipeRow>
    );
  };

  if (view.error && rows.length === 0 && !view.isLoading) {
    return <Text style={[styles.message, { color: colors.secondary }]}>{view.error}</Text>;
  }
  const place = placeTitle(labelId, labels);
  return (
    <LegendList
      data={items}
      keyExtractor={(item) =>
        item.type === "row" ? item.row.threadId : item.type === "day" ? `day:${item.key}` : "pills"
      }
      getItemType={(item) => item.type}
      extraData={colors}
      renderItem={renderItem}
      estimatedItemSize={64}
      recycleItems
      onEndReached={() => void threadLists.fetchNextPage(key)}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 120 }}
      ListEmptyComponent={null}
      ListFooterComponent={
        rows.length === 0 && !view.isLoading ? (
          <View
            style={styles.empty}
            accessible
            accessibilityLabel={unreadOnly ? "No unread mail" : `Nothing in ${place}`}
          >
            <SymbolView name={placeSymbol(labelId)} size={40} tintColor={colors.secondary} />
            <Text style={[styles.emptyTitle, { color: colors.secondary }]}>
              {unreadOnly ? "No unread mail" : `Nothing in ${place}`}
            </Text>
          </View>
        ) : null
      }
      testID="thread-list"
    />
  );
}

const styles = StyleSheet.create({
  message: { padding: 24, paddingTop: 160, fontSize: 15 },
  pills: { flexDirection: "row", gap: 4, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  pill: { paddingHorizontal: 16, minHeight: 36, borderRadius: 18, justifyContent: "center" },
  pillText: { fontSize: 15, fontWeight: "500" },
  day: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 20 },
  dayGap: { marginTop: 16 },
  dayTitle: { fontSize: 13, fontWeight: "500", flex: 1 },
  dayCount: { fontSize: 13, fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
});
