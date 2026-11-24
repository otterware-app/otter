import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { hasToken, setOperator, toggleToken } from "@otter/client/mail/gmail-query";
import { useDebouncedValue, useMailSearch, useMessages } from "@otter/client/mail/hooks";
import { ALL_MAIL_LABEL_ID } from "@otter/client/mail/label-names";
import type { MessageSummary } from "@otter/client/mail/types";
import { Button } from "@otter/ui-native/components/button";
import { Chip } from "@otter/ui-native/components/chip";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, StyleSheet, TextInput, View } from "react-native";

import { MailboxPicker, MailButton } from "../frame/mail-bar.tsx";
import { MailRow } from "./mail-row.tsx";
import { useMailboxes } from "./mailboxes.ts";

export function SearchScreen() {
  const { account } = useLocalSearchParams<{ account: string }>();
  const { mailboxes } = useMailboxes();
  const enabled = mailboxes.filter((mailbox) => mailbox.enabled);
  const [selected, setSelected] = useState(account);
  const [choosing, setChoosing] = useState(false);
  const mailbox = enabled.find(({ look }) => look.id === selected);
  const caps = capabilitiesOf(mailbox?.account);
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 280);
  const results = useMailSearch(search, mailbox ? [mailbox.look.id] : []);
  const inbox = useMessages(mailbox?.account.id ?? null, "INBOX", mailbox?.alias);
  const messages = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages ?? [])
      .flatMap((page) => page.messages)
      .filter((message) => {
        const key = `${message.accountId}:${message.threadId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [results.data]);
  const people = useMemo(() => {
    const from = new Map<string, { email: string; name: string; count: number }>();
    const own = new Set(
      [mailbox?.account.email, ...(mailbox?.account.sendAs ?? [])].map((email) =>
        email?.toLowerCase(),
      ),
    );
    for (const message of inbox.data?.pages[0]?.messages ?? []) {
      const email = message.fromEmail.toLowerCase();
      if (!email || own.has(email)) continue;
      const previous = from.get(email);
      if (previous) previous.count += 1;
      else from.set(email, { email, name: message.fromName || email, count: 1 });
    }
    return [...from.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [inbox.data, mailbox?.account.email, mailbox?.account.sendAs]);

  function refetchMore() {
    if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
  }

  const didSearch = query.trim() !== "";
  const searching = didSearch && (search !== query.trim() || results.isPending);
  const failed = results.data?.pages.some((page) => page.failed?.length);
  const offline = results.data?.pages.some((page) => page.offline);
  const filters = [
    { title: "Unread", token: "is:unread", icon: "envelope.badge" },
    {
      title: caps.stars ? "Starred" : "Flagged",
      token: "is:starred",
      icon: caps.stars ? "star" : "flag",
    },
    { title: "Attachments", token: "has:attachment", icon: "paperclip" },
  ] as const;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Search", headerBackVisible: false }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="xmark"
          accessibilityLabel="Close search"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: theme.colors.card }]}>
          <Icon size={17} name="magnifyingglass" color="mutedForeground" />
          <TextInput
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search messages"
            placeholder="Search messages"
            placeholderTextColor={theme.colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            style={[
              typeStyle(theme, "base", "regular"),
              { flex: 1, color: theme.colors.foreground },
            ]}
          />
          {query && (
            <MailButton
              title="Clear search"
              icon="xmark.circle.fill"
              onPress={() => {
                setQuery("");
              }}
            />
          )}
        </View>
        {mailbox && enabled.length > 1 && (
          <View style={{ alignSelf: "flex-start" }}>
            <Chip
              text={getAccountDisplayName(mailbox.look)}
              variant="glass"
              onPress={() => {
                Keyboard.dismiss();
                setChoosing(true);
              }}
            />
          </View>
        )}
        {!didSearch && (
          <Text size="sm" color="mutedForeground">
            Filters
          </Text>
        )}
        <View style={styles.filters}>
          {filters.map(({ title, token, icon }) => (
            <Chip
              key={token}
              text={title}
              selected={hasToken(query, token)}
              leading={<Icon name={icon} size={12} color="mutedForeground" />}
              onPress={() => setQuery((current) => toggleToken(current, token))}
            />
          ))}
        </View>
      </View>
      <FlashList
        data={didSearch && !searching ? messages : []}
        keyExtractor={(message: MessageSummary) => `${message.accountId}:${message.threadId}`}
        renderItem={({ item }) => (
          <MailRow
            message={item}
            account={mailbox?.look.id ?? item.accountId ?? account}
            label={ALL_MAIL_LABEL_ID}
          />
        )}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: 22 }}
        onEndReached={refetchMore}
        ListHeaderComponent={
          didSearch && (offline || failed) ? (
            <Text size="sm" color="mutedForeground" style={styles.hint}>
              {offline
                ? "Searching mail on this iPhone while offline"
                : "Some results may be missing"}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          didSearch ? (
            searching ? (
              <Spinner />
            ) : (
              <EmptyState
                icon="magnifyingglass"
                title={results.isError ? "Couldn't search" : "No matching messages"}
                description={results.error?.message ?? "Try other words or filters."}
                actions={
                  results.isError && (
                    <Button title="Try again" onPress={() => void results.refetch()} />
                  )
                }
              />
            )
          ) : people.length > 0 ? (
            <View style={styles.people}>
              <Text size="sm" color="mutedForeground" style={{ marginLeft: 12 }}>
                People
              </Text>
              {people.map((person) => (
                <Button
                  key={person.email}
                  title={person.name}
                  icon="person.crop.circle"
                  variant="ghost"
                  onPress={() => setQuery((current) => setOperator(current, "from", person.email))}
                />
              ))}
            </View>
          ) : null
        }
        ListFooterComponent={results.isFetchingNextPage ? <Spinner /> : null}
      />
      <MailboxPicker
        current={selected}
        mailboxes={enabled}
        visible={choosing}
        onClose={() => setChoosing(false)}
        onPick={(id) => {
          setSelected(id);
          setChoosing(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 13, gap: 10 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 13,
    minHeight: 46,
    borderRadius: 15,
    borderCurve: "continuous",
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  hint: { paddingHorizontal: 16, paddingBottom: 12 },
  people: { alignItems: "flex-start", paddingHorizontal: 12, gap: 2 },
});
