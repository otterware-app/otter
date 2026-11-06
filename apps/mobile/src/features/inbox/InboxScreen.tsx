import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { GlassView } from "expo-glass-effect";
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { decodeEntities } from "../../../../web/src/main/mail/text";
import type { RootStack } from "../../App";
import { markFirstContent } from "../../state/startup";
import { accountsAtom, inboxAtom, type ThreadRow } from "../../state/mail";
import { palette, relativeDate } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Inbox">;

export function InboxScreen({ navigation }: Props) {
  const colors = palette(useColorScheme());
  const insets = useSafeAreaInsets();
  const accounts = useAtomValue(accountsAtom);
  const list = AsyncResult.getOrElse(accounts, () => []);
  const [selected, setSelected] = useState<string | null>(null);
  const accountId = selected ?? list[0]?.id ?? null;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {AsyncResult.isFailure(accounts) ? (
        <Text style={[styles.message, { color: colors.secondary }]}>
          Core didn't start: {String(accounts.cause)}
        </Text>
      ) : accountId ? (
        <Inbox
          key={accountId}
          accountId={accountId}
          onOpen={(row) =>
            navigation.navigate("Thread", {
              accountId,
              threadId: row.threadId,
              subject: row.subject || "(no subject)",
            })
          }
        />
      ) : (
        <Text style={[styles.message, { color: colors.secondary }]}>Starting core…</Text>
      )}
      {list.length > 1 ? (
        <GlassView
          style={[styles.bar, { bottom: insets.bottom + 8 }]}
          glassEffectStyle="regular"
          isInteractive
        >
          {list.map((account) => (
            <Pressable
              key={account.id}
              onPress={() => setSelected(account.id)}
              style={styles.barItem}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: account.id === accountId ? colors.accent : colors.text,
                  fontWeight: "600",
                }}
              >
                {account.displayName ?? account.name ?? account.email}
              </Text>
            </Pressable>
          ))}
        </GlassView>
      ) : null}
    </View>
  );
}

function Inbox({ accountId, onOpen }: { accountId: string; onOpen: (row: ThreadRow) => void }) {
  const colors = palette(useColorScheme());
  const result = useAtomValue(inboxAtom(accountId));
  const rows = AsyncResult.getOrElse(result, () => [] as ThreadRow[]);

  useEffect(() => {
    if (rows.length > 0) markFirstContent(rows.length);
  }, [rows.length]);

  if (AsyncResult.isFailure(result)) {
    return (
      <Text style={[styles.message, { color: colors.secondary }]}>{String(result.cause)}</Text>
    );
  }
  return (
    <LegendList
      data={rows}
      keyExtractor={(row) => row.threadId}
      renderItem={({ item }) => <Row row={item} onOpen={onOpen} />}
      estimatedItemSize={76}
      recycleItems
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 96 }}
      testID="inbox-list"
    />
  );
}

export function GateButton({ onPress }: { onPress: () => void }) {
  const colors = palette(useColorScheme());
  return (
    <Pressable onPress={onPress} hitSlop={12} testID="open-gate">
      <Text style={{ color: colors.accent, fontSize: 17 }}>Gate</Text>
    </Pressable>
  );
}

export const Row = memo(function Row({
  row,
  onOpen,
}: {
  row: ThreadRow;
  onOpen?: (row: ThreadRow) => void;
}) {
  const colors = palette(useColorScheme());
  const unread = row.threadUnread ?? row.unread;
  return (
    <Pressable
      onPress={() => onOpen?.(row)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.pressed : "transparent" },
      ]}
    >
      <View style={styles.rowTop}>
        <Text
          numberOfLines={1}
          style={[styles.from, { color: colors.text, fontWeight: unread ? "700" : "500" }]}
        >
          {row.fromName || row.fromEmail}
          {row.threadCount && row.threadCount > 1 ? (
            <Text style={{ color: colors.secondary }}> {row.threadCount}</Text>
          ) : null}
        </Text>
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
  fill: { flex: 1 },
  message: { padding: 24, paddingTop: 160, fontSize: 15 },
  row: { paddingHorizontal: 20, paddingVertical: 10, height: 76 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  from: { flex: 1, fontSize: 16 },
  date: { fontSize: 13 },
  subject: { fontSize: 15, marginTop: 1 },
  snippet: { fontSize: 14, marginTop: 1 },
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 52,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  barItem: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
});
