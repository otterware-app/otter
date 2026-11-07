import { useAtomValue } from "@effect/atom-react";
import { LegendList } from "@legendapp/list/react-native";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { SymbolView } from "expo-symbols";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

import type { RootStack } from "../../App";
import { mailboxes } from "../../state/client";
import { core } from "../../state/core";
import { ThreadRow } from "../home/ThreadRow";
import { usePalette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Search">;

type SearchResult = {
  messages: MessageSummary[];
  cursors?: Record<string, string | null>;
  estimate: number;
  offline?: boolean;
};

/**
 * apps/ios's search: what's on the phone answers at once (`gmail:searchMessages`,
 * the local index), then the provider's own search (`gmail:search`: Gmail's and
 * Microsoft's, past what the phone keeps) adds to it. Pages follow as it scrolls.
 */
export function SearchScreen({ navigation, route }: Props) {
  const colors = usePalette();
  const { accountId } = route.params;
  const mailbox = useAtomValue(mailboxes.mailboxAtom(accountId));
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState<MessageSummary[]>([]);
  const [remote, setRemote] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searching = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        {
          type: "button",
          label: "Close",
          icon: { type: "sfSymbol", name: "xmark" },
          onPress: () => navigation.goBack(),
        },
      ],
      headerSearchBarOptions: {
        placeholder: "Search",
        autoFocus: true,
        hideWhenScrolling: false,
        placement: "stacked",
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onSearchButtonPress: (event) => setQuery(event.nativeEvent.text),
      },
    });
  }, [navigation]);

  useEffect(() => {
    const q = query.trim();
    const id = ++searching.current;
    if (!q) return;
    void core
      .invoke<{ messages: MessageSummary[] }>("gmail:searchMessages", {
        q,
        accountId,
        maxResults: 50,
      })
      .then(
        (page) => {
          if (id !== searching.current) return;
          setLocal(page.messages);
          setSearched(q);
        },
        () => {},
      );
    const timer = setTimeout(() => {
      core
        .invoke<SearchResult>("gmail:search", { q, accountIds: [accountId] })
        .then((next) => {
          if (id !== searching.current) return;
          setRemote(next);
          setSearched(q);
          setError(null);
        })
        .catch(
          (e: unknown) =>
            id === searching.current && setError(e instanceof Error ? e.message : String(e)),
        );
    }, 400);
    return () => clearTimeout(timer);
  }, [query, accountId]);

  const q = query.trim();
  const results = useMemo(() => {
    if (!q) return [];
    const byThread = new Map<string, MessageSummary>();
    for (const row of [...local, ...(remote?.messages ?? [])]) {
      if (!byThread.has(row.threadId)) byThread.set(row.threadId, row);
    }
    return [...byThread.values()].sort((a, b) => b.date - a.date);
  }, [q, local, remote]);

  useEffect(() => {
    if (q && searched === q) {
      AccessibilityInfo.announceForAccessibility(
        results.length > 0 ? `${results.length} results` : "No results",
      );
    }
  }, [q, searched, results.length]);

  const more = async () => {
    if (!remote?.cursors || Object.values(remote.cursors).every((c) => !c)) return;
    const next = await core.invoke<SearchResult>("gmail:search", {
      q: query.trim(),
      accountIds: [accountId],
      cursors: remote.cursors,
    });
    setRemote({ ...next, messages: [...remote.messages, ...next.messages] });
  };

  const name = mailbox?.displayName ?? mailbox?.name ?? mailbox?.email ?? "your mail";
  const empty = (title: string, description: string, symbol: "magnifyingglass") => (
    <View style={styles.empty} accessible accessibilityLabel={`${title}. ${description}`}>
      <SymbolView name={symbol} size={40} tintColor={colors.secondary} />
      <Text style={[styles.emptyTitle, { color: colors.secondary }]}>{title}</Text>
      <Text style={[styles.emptyText, { color: colors.secondary }]}>{description}</Text>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.canvas }]}>
      <LegendList
        data={results}
        keyExtractor={(row) => `${row.accountId ?? accountId}:${row.threadId}`}
        renderItem={({ item }) => (
          <ThreadRow
            row={item}
            accountId={accountId}
            onOpen={(row) =>
              navigation.navigate("Thread", {
                accountId: row.accountId ?? accountId,
                threadId: row.threadId,
                subject: row.subject || "(no subject)",
              })
            }
          />
        )}
        estimatedItemSize={84}
        onEndReached={() => void more()}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          q && (remote?.offline || error) ? (
            <Text style={[styles.meta, { color: colors.secondary }]}>
              {remote?.offline ? "Offline: searching what's on this iPhone." : error}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !q
            ? empty(
                `Search ${name}`,
                "Senders, subjects and words, or from: and is:unread.",
                "magnifyingglass",
              )
            : searched === q
              ? empty("No results", "Try other words, or from: and is:unread.", "magnifyingglass")
              : null
        }
        testID="search-results"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  meta: { paddingHorizontal: 24, paddingVertical: 8, fontSize: 13 },
  empty: { alignItems: "center", gap: 8, paddingTop: 120, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  emptyText: { fontSize: 15, textAlign: "center" },
});
