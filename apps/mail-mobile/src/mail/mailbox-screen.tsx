import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { mailApi } from "@otter/client/mail/api";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { formatDayLabel } from "@otter/client/mail/format";
import { useAccountSync, useLabels, useMarkLabelRead, useMessages } from "@otter/client/mail/hooks";
import { folderName } from "@otter/client/mail/label-names";
import { groupMessagesByDay } from "@otter/client/mail/rows";
import type { MessageSummary } from "@otter/client/mail/types";
import { findVerificationCode } from "@otter/client/mail/verification-code";
import { startup } from "@otter/mobile/start";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { benchmarkAccountId } from "../core.ts";
import {
  FolderPicker,
  MailBar,
  MailButton,
  MailboxPicker,
  MailSheet,
  SheetRow,
} from "../frame/mail-bar.tsx";
import { usePreference } from "../settings/preferences.ts";
import { BenchmarkStatus } from "./benchmark-status.tsx";
import {
  confirmDelete,
  hasLabels,
  LabelSheet,
  mailFailure,
  useMailActions,
  type LabelPicker,
  type MailAction,
} from "./mail-actions.tsx";
import { MailRow } from "./mail-row.tsx";
import { useMailboxes, type Mailbox } from "./mailboxes.ts";
import { mailPointer, sendToAgent, useAgentsInstalled } from "./send-to-agent.ts";

const empty: MessageSummary[] = [];
const codeLifetime = 30 * 60_000;
type Row = { day: number; count: number; unread: number } | { message: MessageSummary };
const unread = (message: MessageSummary) => message.threadUnread ?? message.unread;

export function MailboxScreen() {
  const { account, label } = useLocalSearchParams<{ account: string; label: string }>();
  const { mailboxes, isPending, isError } = useMailboxes();
  const enabled = mailboxes.filter((mailbox) => mailbox.enabled);
  const current = enabled.find((mailbox) => mailbox.look.id === account);
  if (current) {
    return (
      <MailboxList
        key={JSON.stringify([account, label])}
        mailbox={current}
        label={label}
        mailboxes={enabled}
      />
    );
  }
  if (isPending) return <Spinner />;
  if (isError) return <EmptyState title="Couldn't load mailboxes" icon="tray" />;
  return <Redirect href="/" />;
}

function MailboxList({
  mailbox,
  label,
  mailboxes,
}: {
  mailbox: Mailbox;
  label: string;
  mailboxes: Mailbox[];
}) {
  const { account, alias, look } = mailbox;
  const labels = useLabels(account.id, alias);
  const messages = useMessages(account.id, label, alias);
  const sync = useAccountSync(account.id);
  const markLabelRead = useMarkLabelRead();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const groupByDay = usePreference("otter:group-messages-by-day") !== "false";
  const fullWidth = usePreference("otter:full-width-rows") === "true";
  const [sheet, setSheet] = useState<"mailboxes" | "folders" | null>(null);
  const [clock, setClock] = useState(Date.now);
  const [recent, setRecent] = useState<string | null>(null);
  const recentMessages = useMessages(recent ? account.id : null, recent ?? undefined, alias);
  const [labelPicker, setLabelPicker] = useState<LabelPicker | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [hidden, setHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastScroll = useRef(0);
  const agents = useAgentsInstalled();
  const currentLabels = labels.data ?? [];
  const capabilities = capabilitiesOf(account);
  const actions = useMailActions(account, label, currentLabels);
  const isBenchmark = benchmarkAccountId === account.id;
  const signInNeeded = account.signedOut || sync?.signInNeeded;
  const isBin = label === "TRASH" || label === "SPAM";
  const destructive = label === "DRAFT" ? "discard" : isBin ? "delete" : "trash";
  const destructiveTitle =
    destructive === "discard"
      ? "Discard draft"
      : destructive === "delete"
        ? "Delete forever"
        : "Trash";
  const title =
    folderName(label, capabilities) ??
    currentLabels.find((folder) => folder.id === label)?.name ??
    "Mail";
  const all = useMemo(
    () => messages.data?.pages.flatMap((page) => page.messages) ?? empty,
    [messages.data],
  );
  const listed = useMemo(() => (unreadOnly ? all.filter(unread) : all), [all, unreadOnly]);
  const rows = useMemo<Row[]>(() => {
    if (!groupByDay) return listed.map((message) => ({ message }));
    return groupMessagesByDay(listed).flatMap(({ day, messages: entries }) => [
      { day, count: entries.length, unread: entries.filter(unread).length },
      ...(collapsed.has(day) ? [] : entries.map((message) => ({ message }))),
    ]);
  }, [listed, collapsed, groupByDay]);
  const codes = useMemo(() => {
    const found = new Map<string, { code: string; expires: number }>();
    if (isBenchmark || selected || label === "DRAFT") return found;
    for (const message of listed) {
      const expires = message.date + codeLifetime;
      if (expires <= clock) continue;
      const code = findVerificationCode(message.subject, message.snippet);
      if (code) found.set(message.threadId, { code, expires });
    }
    return found;
  }, [isBenchmark, selected, label, listed, clock]);
  useEffect(() => {
    if (!codes.size) return;
    const expires = Math.min(...Array.from(codes.values(), ({ expires }) => expires));
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, expires - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [codes]);
  const picked = selected ? listed.filter((message) => selected.has(message.threadId)) : [];

  function open(next: string, folder: string) {
    setSheet(null);
    if (look.id === next && label === folder) return;
    router.replace({
      pathname: "/mail/[account]/[label]",
      params: { account: next, label: folder },
    });
  }

  function toggleSelection(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function syncNow() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if (!signInNeeded) await mailApi.syncAccount(account.id);
      await messages.refetch();
      await labels.refetch();
    } catch (error) {
      mailFailure(error);
    } finally {
      setRefreshing(false);
    }
  }

  function act(action: MailAction, entries: MessageSummary[], endSelection = false) {
    const run = () => {
      void actions.run(action, entries).then((ok) => {
        if (ok && endSelection) setSelected(null);
      });
    };
    if (action === "delete" || action === "discard")
      confirmDelete(entries.length, action === "discard", run);
    else run();
  }

  function listMenu() {
    const options = ["Select conversations", "Mark all as read", "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1 },
      (index) => {
        if (options[index] === "Select conversations") setSelected(new Set());
        if (options[index] === "Mark all as read") {
          if (alias || label === "ALL_MAIL") act("read", all.filter(unread));
          else markLabelRead.mutate({ accountId: account.id, labelId: label });
        }
      },
    );
  }

  function selectionMenu() {
    const options = [
      { title: "Mark as read", run: () => act("read", picked, true) },
      { title: "Mark as unread", run: () => act("unread", picked, true) },
      ...(capabilities.archiveFolder
        ? [{ title: "Move to", run: () => setLabelPicker("move") }]
        : []),
      ...(hasLabels(account, currentLabels)
        ? [
            {
              title: capabilities.foldersAndCategories ? "Categories" : "Labels",
              run: () => setLabelPicker("label"),
            },
          ]
        : []),
      ...(!isBin && label !== "DRAFT"
        ? [{ title: "Mark as junk", run: () => act("junk", picked, true) }]
        : []),
      ...(agents
        ? [
            {
              title: "Send to agent",
              run: () => sendToAgent(picked.map((message) => mailPointer(account.email, message))),
            },
          ]
        : []),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...options.map(({ title }) => title), "Cancel"],
        cancelButtonIndex: options.length,
      },
      (index) => options[index]?.run(),
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${getAccountDisplayName(look)}, show folders`}
          onPress={() => setSheet("folders")}
          style={styles.heading}
        >
          <Text size="xl" numberOfLines={1}>
            <Text size="xl" weight="semibold">
              {title}
            </Text>{" "}
            <Text size="xl" color="mutedForeground">
              {getAccountDisplayName(look)}
            </Text>
          </Text>
        </Pressable>
        {selected ? (
          <Button title="Done" size="sm" variant="ghost" onPress={() => setSelected(null)} />
        ) : (
          <Glass shape="circle">
            <MailButton title="Mailbox actions" onPress={listMenu}>
              <Icon name="ellipsis" size={19} weight="semibold" color="primary" />
            </MailButton>
          </Glass>
        )}
      </View>
      <FlashList
        data={rows}
        extraData={selected}
        getItemType={(item) => ("day" in item ? "day" : "thread")}
        keyExtractor={(item) => ("day" in item ? `day:${item.day}` : item.message.threadId)}
        renderItem={({ item }) => {
          if ("day" in item)
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed.has(item.day) }}
                onPress={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (!next.delete(item.day)) next.add(item.day);
                    return next;
                  })
                }
                style={styles.day}
              >
                <Icon
                  name={collapsed.has(item.day) ? "chevron.right" : "chevron.down"}
                  size={9}
                  color="mutedForeground"
                />
                <Text size="body" weight="medium" style={{ flex: 1 }}>
                  {formatDayLabel(item.day)}
                </Text>
                <Text size="body" color="mutedForeground" tabular>
                  {item.count}
                  {item.unread > 0 ? ` · ${item.unread} unread` : ""}
                </Text>
              </Pressable>
            );
          const message = item.message;
          const canRestore = isBin || label === "ARCHIVE";
          return (
            <MailRow
              message={message}
              account={look.id}
              label={label}
              own={[account.email, ...(account.sendAs ?? [])]}
              code={codes.get(message.threadId)?.code}
              trashCode={isBin ? undefined : () => act("trash", [message])}
              flagged={!capabilities.stars}
              fullWidth={fullWidth}
              selected={selected?.has(message.threadId)}
              onSelect={() => toggleSelection(message.threadId)}
              leading={
                canRestore
                  ? {
                      title: "Move to Inbox",
                      icon: "tray.and.arrow.down",
                      run: () => act("restore", [message]),
                    }
                  : actions.canArchive(message)
                    ? { title: "Archive", icon: "archivebox", run: () => act("archive", [message]) }
                    : undefined
              }
              trailing={{
                title: destructiveTitle,
                icon: "trash",
                run: () => act(destructive, [message]),
              }}
            />
          );
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          if (!startup.listShownAt && viewableItems.some(({ item }) => "message" in item))
            startup.listShownAt = Date.now();
        }}
        onScroll={({ nativeEvent }) => {
          if (selected || isBenchmark) return;
          const y = nativeEvent.contentOffset.y;
          const delta = y - lastScroll.current;
          if (y < 36 || Math.abs(delta) > 8) setHidden(y >= 36 && delta > 0);
          if (y < 36 || Math.abs(delta) > 8) lastScroll.current = y;
        }}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: insets.bottom + 125 }}
        onEndReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        onRefresh={() => void syncNow()}
        refreshing={refreshing}
        ListHeaderComponent={
          isBenchmark ? (
            <BenchmarkStatus accountId={account.id} status={sync} />
          ) : (
            <View style={styles.listTop}>
              {signInNeeded && (
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/settings/mailbox", params: { account: look.id } })
                  }
                  style={[styles.banner, { backgroundColor: theme.colors.card }]}
                  accessibilityRole="button"
                >
                  <Icon name="exclamationmark.triangle" color="warning" />
                  <Text size="body" style={{ flex: 1 }}>
                    Sign in again to sync this mailbox
                  </Text>
                  <Icon name="chevron.right" size={12} color="mutedForeground" />
                </Pressable>
              )}
              {
                <View style={styles.filters}>
                  {["All", "Unread"].map((filter, index) => {
                    const active = unreadOnly === Boolean(index);
                    return (
                      <Pressable
                        key={filter}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setUnreadOnly(Boolean(index))}
                        style={[
                          styles.filter,
                          active && { backgroundColor: alpha(theme.colors.foreground, 0.08) },
                        ]}
                      >
                        <Text
                          size="md"
                          weight="medium"
                          color={active ? "foreground" : "mutedForeground"}
                        >
                          {filter}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              }
            </View>
          )
        }
        ListEmptyComponent={
          messages.isPending || (!signInNeeded && sync?.syncing) ? (
            <View style={{ paddingTop: 70 }}>
              <Spinner />
            </View>
          ) : (
            <EmptyState
              icon="tray"
              title={
                messages.isError
                  ? "Couldn't load messages"
                  : unreadOnly
                    ? "No unread messages"
                    : `Nothing in ${title}`
              }
              description={messages.isError ? messages.error.message : undefined}
              actions={
                messages.isError ? (
                  <Button title="Try again" onPress={() => void syncNow()} />
                ) : undefined
              }
            />
          )
        }
        ListFooterComponent={messages.isFetchingNextPage ? <Spinner /> : null}
      />
      {selected ? (
        <View pointerEvents="box-none" style={[styles.selectionBar, { bottom: insets.bottom + 6 }]}>
          <Glass style={styles.selectionPill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${picked.length} selected, ${picked.length === listed.length ? "deselect all" : "select all"}`}
              onPress={() =>
                setSelected(
                  picked.length === listed.length
                    ? new Set()
                    : new Set(listed.map((message) => message.threadId)),
                )
              }
              style={styles.selectionCount}
            >
              <Text size="sm" weight="medium">
                {picked.length} selected
              </Text>
            </Pressable>
            {isBin || label === "ARCHIVE" ? (
              <MailButton
                title="Move to Inbox"
                icon="tray.and.arrow.down"
                disabled={!picked.length}
                onPress={() => act("restore", picked, true)}
              />
            ) : (
              <MailButton
                title="Archive"
                icon="archivebox"
                disabled={!picked.some(actions.canArchive)}
                onPress={() => act("archive", picked, true)}
              />
            )}
            <MailButton
              title="Selection actions"
              icon="ellipsis"
              disabled={!picked.length}
              onPress={selectionMenu}
            />
            <MailButton
              title={destructive === "discard" ? "Discard drafts" : destructiveTitle}
              icon="trash"
              disabled={!picked.length}
              onPress={() => act(destructive, picked, true)}
            />
          </Glass>
        </View>
      ) : (
        <MailBar
          mailbox={mailbox}
          label={label}
          reading={hidden && !isBenchmark}
          unread={
            Boolean(labels.data?.find(({ id }) => id === "INBOX")?.unread) ||
            (label === "INBOX" && all.some(unread))
          }
          onMailbox={() => setSheet("mailboxes")}
          onLabel={(id) => open(look.id, id)}
          onFolders={() => setSheet("folders")}
          onSearch={() => router.push({ pathname: "/search", params: { account: look.id } })}
          onCompose={() => router.push({ pathname: "/compose", params: { account: look.id } })}
          onSettings={() => router.push("/settings")}
          onRecents={setRecent}
        />
      )}
      <MailSheet
        title={recent ? (folderName(recent, capabilities) ?? "Recent") : ""}
        visible={recent !== null}
        onClose={() => setRecent(null)}
      >
        {recentMessages.data?.pages[0]?.messages.slice(0, 6).map((message) => (
          <SheetRow
            key={message.threadId}
            title={message.subject || "(No subject)"}
            detail={message.fromName || message.fromEmail}
            icon={recent === "DRAFT" ? "square.and.pencil" : "envelope"}
            onPress={() => {
              const folder = recent ?? "INBOX";
              setRecent(null);
              if (folder === "DRAFT")
                router.push({
                  pathname: "/compose",
                  params: { account: look.id, draft: message.id, thread: message.threadId },
                });
              else
                router.push({
                  pathname: "/mail/[account]/[label]/[thread]",
                  params: { account: look.id, label: folder, thread: message.threadId },
                });
            }}
          />
        ))}
        {recentMessages.isPending && recent ? <Spinner /> : null}
        <SheetRow
          title="Open folder"
          icon="folder"
          onPress={() => {
            if (recent) open(look.id, recent);
            setRecent(null);
          }}
        />
      </MailSheet>
      <MailboxPicker
        current={look.id}
        visible={sheet === "mailboxes"}
        mailboxes={mailboxes}
        onClose={() => setSheet(null)}
        onPick={(id) => open(id, "INBOX")}
      />
      <FolderPicker
        mailbox={mailbox}
        labels={currentLabels}
        selected={label}
        status={sync}
        visible={sheet === "folders"}
        onClose={() => setSheet(null)}
        onPick={(id) => open(look.id, id)}
        onSync={() => {
          setSheet(null);
          void syncNow();
        }}
      />
      <LabelSheet
        kind={labelPicker}
        account={account}
        labels={currentLabels}
        threads={picked}
        onClose={() => setLabelPicker(null)}
        onChange={(kind, id) => {
          void actions.changeLabel(kind, id, picked).then((ok) => {
            if (ok) setSelected(null);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 50,
    paddingLeft: 16,
    paddingRight: 16,
  },
  heading: { flex: 1, paddingVertical: 3, alignItems: "flex-start" },
  listTop: { gap: 7, paddingHorizontal: 16 },
  filters: { flexDirection: "row", gap: 3, paddingTop: 10, paddingBottom: 8 },
  filter: {
    minHeight: 36,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 12 },
  day: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    minHeight: 44,
    marginTop: 22,
  },
  selectionBar: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  selectionPill: { flexDirection: "row", alignItems: "center", padding: 4 },
  selectionCount: { justifyContent: "center", height: 44, paddingHorizontal: 13 },
});
