import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { hasToken, setOperator, toggleToken } from "@otter/client/mail/gmail-query";
import { useDebouncedValue, useMailSearch, useMessages } from "@otter/client/mail/hooks";
import { ALL_MAIL_LABEL_ID } from "@otter/client/mail/label-names";
import type { MessageSummary } from "@otter/client/mail/types";
import { Button } from "@otter/ui-native/components/button";
import { Chip } from "@otter/ui-native/components/chip";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, typeStyle, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { MailboxPicker, MailButton } from "../frame/mail-bar.tsx";
import { MailRow } from "./mail-row.tsx";
import { useMailboxes } from "./mailboxes.ts";
import { SenderAvatar } from "./sender-avatar.tsx";

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
    const threads = (inbox.data?.pages ?? []).flatMap((page) => page.messages).slice(0, 200);
    for (const thread of threads) {
      for (const sender of thread.threadSenders ?? [
        { name: thread.fromName, email: thread.fromEmail },
      ]) {
        const email = sender.email.toLowerCase();
        if (!email || own.has(email)) continue;
        const previous = from.get(email);
        if (previous) previous.count += 1;
        else from.set(email, { email, name: sender.name || sender.email, count: 1 });
      }
    }
    return [...from.values()]
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
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
  ] satisfies { title: string; token: string; icon: IconName }[];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Glass interactive style={styles.search}>
          <Icon size={17} name="magnifyingglass" color="mutedForeground" />
          <TextInput
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search messages"
            placeholder="Search"
            placeholderTextColor={theme.colors.mutedForeground}
            selectionColor={theme.colors.primary}
            value={query}
            onChangeText={setQuery}
            style={[
              typeStyle(theme, "lg", "regular"),
              { flex: 1, color: theme.colors.foreground, paddingVertical: 0 },
            ]}
          />
          {query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
              onPress={() => setQuery("")}
            >
              <Icon name="xmark.circle.fill" size={17} color="mutedForeground" />
            </Pressable>
          )}
        </Glass>
        <Glass shape="circle">
          <MailButton title="Close search" icon="xmark" onPress={() => router.back()} />
        </Glass>
      </View>
      {mailbox && enabled.length > 1 && (
        <View style={styles.mailbox}>
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
      <View style={styles.filters}>
        {!didSearch && (
          <Text size="body" weight="medium" color="mutedForeground" style={styles.heading}>
            Filters
          </Text>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
        >
          {filters.map(({ title, token, icon }) => {
            const selected = hasToken(query, token);
            return (
              <Pressable
                key={token}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setQuery((current) => toggleToken(current, token))}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected
                      ? alpha(theme.colors.primary, 0.16)
                      : alpha(theme.colors.foreground, 0.06),
                    opacity: pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Icon name={icon} size={15} />
                <Text size="md">{title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
              <Text size="body" weight="medium" color="mutedForeground" style={styles.heading}>
                People
              </Text>
              {people.map((person) => (
                <Pressable
                  key={person.email}
                  accessibilityRole="button"
                  accessibilityLabel={`Mail from ${person.name}`}
                  onPress={() => setQuery((current) => setOperator(current, "from", person.email))}
                  style={({ pressed }) => [styles.person, pressed && { opacity: 0.6 }]}
                >
                  <SenderAvatar
                    account={mailbox?.account.id ?? account}
                    email={person.email}
                    name={person.name}
                    size={32}
                  />
                  <View style={styles.personText}>
                    <Text size="md" numberOfLines={1}>
                      {person.name}
                    </Text>
                    <Text size="xs" color="mutedForeground" numberOfLines={1}>
                      {person.email}
                    </Text>
                  </View>
                </Pressable>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 14,
  },
  mailbox: { alignSelf: "flex-start", paddingHorizontal: 16, paddingTop: 8 },
  filters: { paddingTop: 20, paddingBottom: 12, gap: 10 },
  heading: { paddingHorizontal: 20 },
  chips: { paddingHorizontal: 20, gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  hint: { paddingHorizontal: 16, paddingBottom: 12 },
  people: { paddingTop: 12, gap: 4 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 50,
    paddingHorizontal: 20,
  },
  personText: { flex: 1, gap: 1 },
});
