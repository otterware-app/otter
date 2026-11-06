import { LegendList } from "@legendapp/list/react-native";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";

import type { RootStack } from "../../App";
import { core } from "../../state/core";
import { ThreadRow } from "../home/ThreadRow";
import { palette } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Search">;

type SearchResult = {
  messages: MessageSummary[];
  cursors?: Record<string, string | null>;
  estimate: number;
  offline?: boolean;
};

/**
 * Search runs on the server (`gmail:search`: Gmail's and Microsoft's own
 * search, past what the phone keeps), falling back to the local index
 * offline and for IMAP. Pages follow as the list scrolls.
 */
export function SearchScreen({ navigation, route }: Props) {
  const colors = palette(useColorScheme());
  const { accountId } = route.params;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder: "Search mail",
        autoFocus: true,
        hideWhenScrolling: false,
        onChangeText: (event) => setQuery(event.nativeEvent.text),
        onSearchButtonPress: (event) => setQuery(event.nativeEvent.text),
      },
    });
  }, [navigation]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResult(null);
    const id = ++searching.current;
    const timer = setTimeout(() => {
      core
        .invoke<SearchResult>("gmail:search", { q, accountIds: [accountId] })
        .then((next) => {
          if (id !== searching.current) return;
          setResult(next);
          setError(null);
        })
        .catch((e: unknown) => id === searching.current && setError(String(e)));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, accountId]);

  const more = async () => {
    if (!result?.cursors) return;
    const next = await core.invoke<SearchResult>("gmail:search", {
      q: query.trim(),
      accountIds: [accountId],
      cursors: result.cursors,
    });
    setResult({ ...next, messages: [...result.messages, ...next.messages] });
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <LegendList
        data={result?.messages ?? []}
        keyExtractor={(row) => `${row.accountId}:${row.threadId}`}
        renderItem={({ item }) => (
          <ThreadRow
            row={item}
            onOpen={(row) =>
              navigation.navigate("Thread", {
                accountId: row.accountId ?? accountId,
                threadId: row.threadId,
                subject: row.subject || "(no subject)",
              })
            }
          />
        )}
        estimatedItemSize={80}
        onEndReached={() => void more()}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          result ? (
            <Text style={[styles.meta, { color: colors.secondary }]}>
              {result.offline ? "Offline: searching what's on this iPhone. " : ""}
              {result.estimate > 0 ? `About ${result.estimate} results` : "No results"}
            </Text>
          ) : error ? (
            <Text style={[styles.meta, { color: colors.secondary }]}>{error}</Text>
          ) : null
        }
        testID="search-results"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  meta: { paddingHorizontal: 24, paddingVertical: 8, fontSize: 13 },
});
