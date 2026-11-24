import { useDebouncedValue, useSearchMessages } from "@otter/client/mail/hooks";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { MailRow } from "./mail-row.tsx";

export function SearchScreen() {
  const { account } = useLocalSearchParams<{ account: string }>();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 250);
  const results = useSearchMessages(search, account);
  return (
    <View style={{ flex: 1 }}>
      <TextInput
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search messages"
        placeholder="Search messages"
        placeholderTextColor={theme.colors.mutedForeground}
        value={query}
        onChangeText={setQuery}
        style={[
          typeStyle(theme, "base", "regular"),
          {
            color: theme.colors.foreground,
            backgroundColor: theme.colors.card,
            borderRadius: 12,
            margin: 16,
            paddingHorizontal: 12,
            minHeight: 44,
          },
        ]}
      />
      <FlashList
        data={results.data?.pages.flatMap((page) => page.messages) ?? []}
        keyExtractor={(message) => message.threadId}
        renderItem={({ item }) => (
          <MailRow message={item} account={item.accountId ?? account} label="ALL_MAIL" />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => {
          if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
        }}
        ListEmptyComponent={
          search ? (
            results.isFetching ? (
              <Text size="sm" color="mutedForeground" style={{ padding: 16 }}>
                Searching…
              </Text>
            ) : (
              <EmptyState
                title={results.isError ? "Couldn't search" : "No matching messages"}
                description={results.error?.message}
              />
            )
          ) : null
        }
      />
    </View>
  );
}
