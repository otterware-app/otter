import { getAccountDisplayName, getAccountPicture } from "@otter/client/mail/account-style";
import { mailApi } from "@otter/client/mail/api";
import { formatDayLabel } from "@otter/client/mail/format";
import { useAccounts, useAccountSync, useLabels, useMessages } from "@otter/client/mail/hooks";
import {
  ALL_MAIL_LABEL_ID,
  labelDisplayName,
  SYSTEM_LABEL_NAMES,
} from "@otter/client/mail/label-names";
import { groupMessagesByDay } from "@otter/client/mail/rows";
import type { MailAccount, MessageSummary, SyncStatus } from "@otter/client/mail/types";
import { longTasks } from "@otter/mobile/long-tasks";
import { startup } from "@otter/mobile/start";
import { Avatar } from "@otter/ui-native/components/avatar";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { benchmarkAccountId } from "../core.ts";
import { MailRow } from "./mail-row.tsx";

const shortcuts = [
  { id: "INBOX", title: "Inbox", icon: "tray" },
  { id: "STARRED", title: "Starred", icon: "star" },
] as const;
const empty: MailAccount[] = [];
type Row = { day: number } | { message: MessageSummary };

export function MailboxScreen() {
  const { account, label } = useLocalSearchParams<{ account: string; label: string }>();
  const accounts = useAccounts();
  const mailboxes = accounts.data ?? empty;
  const labels = useLabels(account);
  const messages = useMessages(account, label);
  const sync = useAccountSync(account);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const current = mailboxes.find((mailbox) => mailbox.id === account);
  const title =
    label === ALL_MAIL_LABEL_ID
      ? "All Mail"
      : (SYSTEM_LABEL_NAMES[label] ??
        labels.data?.find((folder) => folder.id === label)?.name ??
        "Mail");
  const rows = useMemo<Row[]>(() => {
    const all = messages.data?.pages.flatMap((page) => page.messages) ?? [];
    return groupMessagesByDay(all).flatMap(({ day, messages: entries }) => [
      { day },
      ...entries.map((message) => ({ message })),
    ]);
  }, [messages.data]);

  const open = (nextAccount: string, nextLabel: string) =>
    router.replace({
      pathname: "/mail/[account]/[label]",
      params: { account: nextAccount, label: nextLabel },
    });

  const chooseMailbox = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Mailboxes",
        options: [...mailboxes.map(getAccountDisplayName), "Cancel"],
        cancelButtonIndex: mailboxes.length,
      },
      (index) => {
        if (mailboxes[index]) open(mailboxes[index].id, "INBOX");
      },
    );
  };

  const chooseFolder = () => {
    const folders = [
      { id: ALL_MAIL_LABEL_ID, title: "All Mail" },
      ...(labels.data ?? [])
        .filter(
          (folder) =>
            folder.type === "user" ||
            ["SENT", "DRAFT", "ARCHIVE", "TRASH", "SPAM"].includes(folder.id),
        )
        .map((folder) => ({ id: folder.id, title: labelDisplayName(folder) })),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Folders",
        options: [...folders.map((folder) => folder.title), "Cancel"],
        cancelButtonIndex: folders.length,
      },
      (index) => {
        if (folders[index]) open(account, folders[index].id);
      },
    );
  };

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title }} />
      <FlashList
        key={`${account}:${label}`}
        data={rows}
        getItemType={(item) => ("day" in item ? "day" : "thread")}
        keyExtractor={(item) => ("day" in item ? `day:${item.day}` : item.message.threadId)}
        renderItem={({ item }) =>
          "day" in item ? (
            <Text
              size="sm"
              weight="semibold"
              color="mutedForeground"
              accessibilityRole="header"
              style={styles.day}
            >
              {formatDayLabel(item.day)}
            </Text>
          ) : (
            <MailRow message={item.message} account={account} label={label} />
          )
        }
        onViewableItemsChanged={({ viewableItems }) => {
          if (!startup.listShownAt && viewableItems.some(({ item }) => "message" in item)) {
            startup.listShownAt = Date.now();
          }
        }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: insets.bottom + 112 }}
        onEndReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        onRefresh={() => void messages.refetch()}
        refreshing={messages.isRefetching && !messages.isFetchingNextPage}
        ListHeaderComponent={
          benchmarkAccountId === account ? (
            <BenchmarkStatus accountId={account} status={sync} />
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="tray"
            title={
              messages.isError
                ? "Couldn't load messages"
                : messages.isPending || sync?.syncing
                  ? "Loading messages…"
                  : "No messages"
            }
            description={messages.isError ? messages.error.message : undefined}
            actions={
              messages.isError ? (
                <Button title="Try again" onPress={() => void messages.refetch()} />
              ) : undefined
            }
          />
        }
      />
      <View
        style={[
          styles.bars,
          { paddingBottom: insets.bottom, backgroundColor: theme.colors.canvas },
        ]}
      >
        <Glass style={styles.pill}>
          <BarButton title="Mailboxes" onPress={chooseMailbox}>
            <Avatar
              size={27}
              source={current && getAccountPicture(current)}
              initials={(current && getAccountDisplayName(current)[0]) || "O"}
            />
          </BarButton>
          <BarButton
            title="Search"
            icon="magnifyingglass"
            onPress={() => router.push({ pathname: "/search", params: { account } })}
          />
          <BarButton
            title="Compose"
            icon="square.and.pencil"
            onPress={() => router.push({ pathname: "/compose", params: { account } })}
          />
        </Glass>
        <View style={styles.tabs}>
          {shortcuts.map((shortcut) => (
            <BarButton
              key={shortcut.id}
              title={shortcut.title}
              icon={shortcut.icon}
              selected={label === shortcut.id}
              onPress={() => open(account, shortcut.id)}
            />
          ))}
          <BarButton title="Folders" icon="folder" onPress={chooseFolder} />
          <BarButton title="Settings" icon="gearshape" onPress={() => router.push("/settings")} />
        </View>
      </View>
    </View>
  );
}

function BarButton({
  title,
  icon,
  onPress,
  selected,
  children,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  selected?: boolean;
  children?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.button}
    >
      {children ?? <Icon name={icon!} size={22} color={selected ? "primary" : "foreground"} />}
    </Pressable>
  );
}

function BenchmarkStatus({ accountId, status }: { accountId: string; status: SyncStatus | null }) {
  const [result, setResult] = useState<string>();
  const [replay, setReplay] = useState<string>();
  const [running, setRunning] = useState(false);
  const complete = status?.fullSyncDone && !status.syncing;
  useEffect(() => {
    if (!complete || result || !startup.listShownAt) return;
    const timer = setTimeout(() => {
      const { longest, p95 } = longTasks(startup.launchedAt);
      setResult(
        `First row ${startup.listShownAt - startup.launchedAt} ms · max ${longest} ms · p95 ${p95} ms`,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [complete, result]);

  async function runReplay() {
    setRunning(true);
    setReplay("Preparing 200 fake Gmail changes…");
    try {
      const { stageLargeGmailChanges } = await import("@otter/core/fake");
      const { revision } = await mailApi.getSyncStatus(accountId);
      await stageLargeGmailChanges(accountId, 200);
      setReplay("Replaying 200 changes…");
      const start = Date.now();
      let current = await mailApi.syncAccount(accountId);
      while (current.syncing || current.revision <= revision) {
        if (current.error) throw new Error(current.error);
        if (Date.now() - start > 60_000) throw new Error("History sync timed out.");
        await new Promise((resolve) => setTimeout(resolve, 50));
        current = await mailApi.getSyncStatus(accountId);
      }
      if (current.error) throw new Error(current.error);
      const { longest, p95 } = longTasks(start);
      setReplay(`200 changes · ${Date.now() - start} ms · max ${longest} ms · p95 ${p95} ms`);
    } catch (error) {
      setReplay(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={styles.day}>
      <Text size="sm" color="mutedForeground" accessibilityLiveRegion="polite">
        {result ?? `Syncing benchmark mailbox · ${status?.synced ?? 0} messages cached`}
      </Text>
      {result && (
        <Button title="Replay 200 changes" disabled={running || !complete} onPress={runReplay} />
      )}
      {replay && <Text size="sm">{replay}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  day: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 5 },
  bars: {
    position: "absolute",
    bottom: 0,
    alignSelf: "stretch",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingTop: 5,
    gap: 5,
  },
  pill: { flexDirection: "row", minHeight: 48, paddingHorizontal: 7 },
  tabs: { flexDirection: "row", minHeight: 44, justifyContent: "center", width: "100%" },
  button: { width: 56, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
