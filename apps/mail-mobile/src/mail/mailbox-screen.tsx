import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { mailApi } from "@otter/client/mail/api";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import {
  useAccountSync,
  useLabels,
  useMarkLabelRead,
  useMessages,
  useSyncStatus,
} from "@otter/client/mail/hooks";
import { folderName } from "@otter/client/mail/label-names";
import { groupMessagesByDay } from "@otter/client/mail/rows";
import type { MessageSummary, SyncStatus } from "@otter/client/mail/types";
import { startup } from "@otter/mobile/start";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { Link, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { LayoutAnimation, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LayoutAnimationConfig,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { autoBenchmark, benchmarkAccountId } from "../core.ts";
import {
  MailBar,
  MailboxesCard,
  MailButton,
  MailPopover,
  PlacesCard,
  RecentsCard,
} from "../frame/mail-bar.tsx";
import { MenuButton, type MenuAction } from "../frame/menu-button.tsx";
import { usePreference } from "../settings/preferences.ts";
import { BenchmarkStatus } from "./benchmark-status.tsx";
import { dayLabel } from "./format-date.ts";
import {
  confirmDelete,
  hasLabels,
  labelChoices,
  LabelSheet,
  mailFailure,
  useMailActions,
  type LabelPicker,
  type MailAction,
} from "./mail-actions.tsx";
import { MailRow } from "./mail-row.tsx";
import { rowLabels } from "@otter/client/mail/rows";
import { useRecoveries, useRecoveryOwner, type RecoveryDraft } from "./draft-recovery.ts";
import { mayHaveVerificationCode } from "./verification-code.ts";
import { useMailboxes, type Mailbox } from "./mailboxes.ts";
import { mailPointer, sendToAgent, useAgentsInstalled } from "./send-to-agent.ts";

const empty: MessageSummary[] = [];
const emptyDrafts: RecoveryDraft[] = [];
const codeLifetime = 30 * 60_000;
type Row = { day: number; count: number; unread: number } | { message: MessageSummary };
/** What takes a conversation out of the list it's in. */
const leavesList = new Set<MailAction>([
  "archive",
  "trash",
  "restore",
  "junk",
  "delete",
  "discard",
]);
/** Selecting swaps the bar for the selection's, as SwiftUI's `.smooth(duration: 0.18)`. */
const barIn = FadeIn.duration(180);
const barOut = FadeOut.duration(180);
const unread = (message: MessageSummary) => message.threadUnread ?? message.unread;
const syncFlags = ({ signInNeeded, syncing }: SyncStatus) => ({ signInNeeded, syncing });

/** Syncs the mailbox and refreshes its lists, apart from the list: while it syncs, its status moves at every poll. */
function AccountSync({ accountId }: { accountId: string }) {
  useAccountSync(accountId);
  return null;
}

// A message keeps its row while the list refetches (React Query keeps unchanged messages as they
// were), so the rows that didn't change aren't drawn again.
const messageRows = new WeakMap<MessageSummary, Row>();
function messageRow(message: MessageSummary): Row {
  let row = messageRows.get(message);
  if (!row) messageRows.set(message, (row = { message }));
  return row;
}

export function MailboxScreen() {
  const { account, label } = useLocalSearchParams<{ account: string; label: string }>();
  const { mailboxes, isPending, isError } = useMailboxes();
  const enabled = mailboxes.filter((mailbox) => mailbox.enabled);
  const current = enabled.find((mailbox) => mailbox.look.id === account);
  if (current) {
    return <MailboxList mailbox={current} label={label} mailboxes={enabled} />;
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
  const owner = useRecoveryOwner();
  const recoveries = useRecoveries(owner, label === "DRAFT").data;
  const keptDrafts = useMemo(
    () =>
      label === "DRAFT" && recoveries
        ? recoveries.filter(
            (draft) =>
              draft.account === look.id ||
              (!alias &&
                (draft.sender.id === account.id ||
                  draft.sender.id === account.email.toLowerCase()) &&
                !mailboxes.some(({ look }) => look.id === draft.account)),
          )
        : emptyDrafts,
    [label, recoveries, look.id, alias, account.id, account.email, mailboxes],
  );
  const labels = useLabels(account.id, alias);
  const messages = useMessages(account.id, label, alias);
  const sync = useSyncStatus(account.id, syncFlags);
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
  const list = useRef<FlashListRef<Row>>(null);
  const place = `${look.id}\n${label}`;
  // Another place is the same screen with what it shows set again, as the Swift app's `select`:
  // no screen pushed over this one, the bar staying put.
  const [shownPlace, setShownPlace] = useState(place);
  if (shownPlace !== place) {
    setShownPlace(place);
    setSheet(null);
    setRecent(null);
    setLabelPicker(null);
    setUnreadOnly(false);
    setCollapsed(new Set());
    setSelected(null);
    setHidden(false);
  }
  const autoScroll = useCallback(
    (offset: number) => list.current?.scrollToOffset({ offset, animated: true }),
    [],
  );
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
  const all = useMemo(() => {
    const rows = messages.data?.pages.flatMap((page) => page.messages) ?? empty;
    if (!keptDrafts.length) return rows;
    const known = new Set(keptDrafts.map(({ anchor }) => anchor.messageId));
    return rows.filter(({ id }) => !known.has(id));
  }, [messages.data, keptDrafts]);
  const listed = useMemo(() => (unreadOnly ? all.filter(unread) : all), [all, unreadOnly]);
  const rows = useMemo<Row[]>(() => {
    if (!groupByDay) return listed.map(messageRow);
    return groupMessagesByDay(listed).flatMap(({ day, messages: entries }) => [
      { day, count: entries.length, unread: entries.filter(unread).length },
      ...(collapsed.has(day) ? [] : entries.map(messageRow)),
    ]);
  }, [listed, collapsed, groupByDay]);
  const codes = useMemo(() => {
    const found = new Map<string, number>();
    if (isBenchmark || selected || label === "DRAFT") return found;
    for (const message of listed) {
      const expires = message.date + codeLifetime;
      if (expires <= clock) continue;
      if (mayHaveVerificationCode(message)) found.set(message.threadId, expires);
    }
    return found;
  }, [isBenchmark, selected, label, listed, clock]);
  useEffect(() => {
    if (!codes.size) return;
    const expires = Math.min(...codes.values());
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, expires - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [codes]);
  const picked = selected ? listed.filter((message) => selected.has(message.threadId)) : [];
  const stickyDays = useMemo(
    () => rows.flatMap((row, index) => ("day" in row ? [index] : [])),
    [rows],
  );

  function open(next: string, folder: string) {
    setSheet(null);
    if (look.id === next && label === folder) return;
    lastScroll.current = 0;
    router.setParams({ account: next, label: folder });
  }

  /** Rows coming and going ease into place, as SwiftUI's `withAnimation` around the change. */
  const animateRows = useCallback((duration: number) => {
    list.current?.prepareForLayoutAnimationRender();
    LayoutAnimation.configureNext(LayoutAnimation.create(duration, "easeInEaseOut", "opacity"));
  }, []);

  function toggleDay(day: number) {
    animateRows(300);
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(day)) next.add(day);
      return next;
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
      if (leavesList.has(action)) animateRows(180);
      void actions.run(action, entries).then((ok) => {
        if (ok && endSelection) setSelected(null);
      });
    };
    if (action === "delete" || action === "discard")
      confirmDelete(entries.length, action === "discard", run);
    else run();
  }

  function markAllRead() {
    if (alias || label === "ALL_MAIL") act("read", all.filter(unread));
    else markLabelRead.mutate({ accountId: account.id, labelId: label });
  }

  function compose(params: Record<string, string> = {}) {
    router.push({ pathname: "/compose", params: { account: look.id, ...params } });
  }

  function openThread(folder: string, message: MessageSummary) {
    if (folder === "DRAFT" && message.labelIds.includes("DRAFT"))
      compose({ draft: message.id, thread: message.threadId });
    else
      router.push({
        pathname: "/mail/[account]/[label]/[thread]",
        params: { account: look.id, label: folder, thread: message.threadId },
      });
  }

  const labelsTitle = capabilities.foldersAndCategories ? "Categories" : "Labels";
  const selectionActions: MenuAction[] = [
    { title: "Mark as read", icon: "envelope.open", onPress: () => act("read", picked, true) },
    { title: "Mark as unread", icon: "envelope.badge", onPress: () => act("unread", picked, true) },
    ...(hasLabels(account, currentLabels)
      ? [{ title: labelsTitle, icon: "tag" as const, onPress: () => setLabelPicker("label") }]
      : []),
    ...(capabilities.archiveFolder
      ? [{ title: "Move to", icon: "folder" as const, onPress: () => setLabelPicker("move") }]
      : []),
    ...(!isBin && label !== "DRAFT"
      ? [
          {
            title: "Report junk",
            icon: "xmark.bin" as const,
            onPress: () => act("junk", picked, true),
          },
        ]
      : []),
  ];

  const menuChoices = useMemo(
    () => ({
      label: labelChoices("label", account, currentLabels),
      move: labelChoices("move", account, currentLabels),
    }),
    [account, currentLabels],
  );

  function rowMenu(message: MessageSummary) {
    const has = (id: string) => rowLabels(message).includes(id);
    const choices = (kind: "label" | "move") =>
      menuChoices[kind].map(({ id, title }) => (
        <Link.MenuAction
          key={id}
          isOn={has(id)}
          onPress={() => void actions.changeLabel(kind, id, [message])}
        >
          {title}
        </Link.MenuAction>
      ));
    const isUnread = unread(message);
    const starred = message.threadStarred ?? message.starred;
    const mark = capabilities.stars ? "star" : "flag";
    const markTitle = capabilities.stars ? "Star" : "Flag";
    return (
      <Link.Menu>
        <Link.Menu inline>
          {agents ? (
            <Link.MenuAction
              icon="sparkles"
              onPress={() => sendToAgent([mailPointer(account.email, message)])}
            >
              Send to agent
            </Link.MenuAction>
          ) : null}
          <Link.MenuAction
            icon={isUnread ? "envelope.open" : "envelope.badge"}
            onPress={() => act(isUnread ? "read" : "unread", [message])}
          >
            {isUnread ? "Mark as read" : "Mark as unread"}
          </Link.MenuAction>
          <Link.MenuAction
            icon={starred ? `${mark}.slash` : mark}
            onPress={() => act(starred ? "unstar" : "star", [message])}
          >
            {starred ? `Un${markTitle.toLowerCase()}` : markTitle}
          </Link.MenuAction>
          {hasLabels(account, currentLabels) ? (
            <Link.Menu title={labelsTitle} icon="tag">
              {choices("label")}
            </Link.Menu>
          ) : null}
          {capabilities.archiveFolder ? (
            <Link.Menu title="Move to" icon="folder">
              {choices("move")}
            </Link.Menu>
          ) : null}
        </Link.Menu>
        <Link.Menu inline>
          {actions.canArchive(message) ? (
            <Link.MenuAction icon="archivebox" onPress={() => act("archive", [message])}>
              Archive
            </Link.MenuAction>
          ) : null}
          {isBin || label === "ARCHIVE" ? (
            <Link.MenuAction icon="tray.and.arrow.down" onPress={() => act("restore", [message])}>
              Move to Inbox
            </Link.MenuAction>
          ) : null}
          {!isBin && label !== "DRAFT" ? (
            <Link.MenuAction icon="xmark.bin" onPress={() => act("junk", [message])}>
              Report junk
            </Link.MenuAction>
          ) : null}
          <Link.MenuAction icon="trash" destructive onPress={() => act(destructive, [message])}>
            {destructiveTitle}
          </Link.MenuAction>
        </Link.Menu>
      </Link.Menu>
    );
  }

  const own = useMemo(
    () => [account.email, ...(account.sendAs ?? [])],
    [account.email, account.sendAs],
  );
  const codeKey = [...codes.keys()].join("\n");
  const labelsKey = currentLabels.map(({ id, name }) => `${id}:${name}`).join("\n");
  const latest = useRef<RowHandlers>(null!);
  // oxlint-disable-next-line react/refs -- Rows call the latest handlers; `rowContext` says when they draw again.
  latest.current = {
    act,
    toggleSelection,
    toggleDay,
    rowMenu,
    canArchive: actions.canArchive,
    hasCode: (threadId) => codes.has(threadId),
  };
  // Rows draw again when what they show changes, not each time the list does (as sync's status
  // moves): `codeKey`, `labelsKey` and `agents` change what `latest` gives them.
  const rowContext = useMemo<RowContext>(
    () => ({
      look: look.id,
      accountId: account.id,
      label,
      own,
      flagged: !capabilities.stars,
      fullWidth,
      selected,
      collapsed,
      canvas: theme.colors.canvas,
      error: theme.colors.error,
      archive: theme.scheme === "dark" ? "#5e5ce6" : "#5856d6",
      restore: theme.colors.primary,
      destructive,
      destructiveTitle,
      latest,
      keys: [codeKey, labelsKey, agents],
    }),
    [
      look.id,
      account.id,
      label,
      own,
      capabilities.stars,
      fullWidth,
      selected,
      collapsed,
      theme.colors.canvas,
      theme.colors.error,
      theme.colors.primary,
      theme.scheme,
      destructive,
      destructiveTitle,
      codeKey,
      labelsKey,
      agents,
    ],
  );

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <AccountSync accountId={account.id} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${getAccountDisplayName(look)}, show folders`}
          onPress={() => setSheet(sheet === "folders" ? null : "folders")}
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
          <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
            <Glass interactive style={styles.done}>
              <Text size="lg" color="primary">
                Done
              </Text>
            </Glass>
          </Pressable>
        ) : (
          <MenuButton
            accessibilityLabel="More"
            sections={[
              [
                {
                  title: "Select messages",
                  icon: "checkmark.circle",
                  disabled: listed.length === 0,
                  onPress: () => setSelected(new Set()),
                },
                {
                  title: "Mark all as read",
                  icon: "envelope.open",
                  disabled: !all.some(unread),
                  onPress: markAllRead,
                },
              ],
            ]}
          >
            <Glass shape="circle" style={styles.more}>
              <Icon name="ellipsis" size={14} weight="semibold" color="primary" />
            </Glass>
          </MenuButton>
        )}
      </View>
      <FlashList
        key={place}
        ref={list}
        data={rows}
        extraData={rowContext}
        getItemType={(item) => ("day" in item ? "day" : "thread")}
        keyExtractor={(item) => ("day" in item ? `day:${item.day}` : item.message.threadId)}
        stickyHeaderIndices={stickyDays}
        renderItem={renderRow}
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
            <BenchmarkStatus
              accountId={account.id}
              scrollTo={autoBenchmark ? autoScroll : undefined}
            />
          ) : (
            <View style={styles.listTop}>
              {keptDrafts.map((draft) => (
                <Pressable
                  key={draft.id}
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      pathname: "/compose",
                      params: { account: look.id, recovery: draft.id },
                    })
                  }
                  style={[styles.banner, { backgroundColor: theme.colors.card }]}
                >
                  <Icon name="square.and.pencil" color="mutedForeground" />
                  <View style={{ flex: 1 }}>
                    <Text size="md" weight="medium" numberOfLines={1}>
                      {draft.fields.subject || "(No subject)"}
                    </Text>
                    <Text size="body" color="mutedForeground">
                      Saved on this iPhone
                    </Text>
                  </View>
                  <Icon name="chevron.right" size={12} color="mutedForeground" />
                </Pressable>
              ))}
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
                        onPress={() => {
                          if (unreadOnly === Boolean(index)) return;
                          animateRows(180);
                          setUnreadOnly(Boolean(index));
                        }}
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
      <MailPopover
        visible={recent !== null}
        reading={hidden}
        align={recent === "DRAFT" ? "right" : "left"}
        onClose={() => setRecent(null)}
      >
        <RecentsCard
          folder={recent ?? "INBOX"}
          messages={recentMessages.data?.pages[0]?.messages ?? empty}
          onOpen={(message) => {
            const folder = recent ?? "INBOX";
            setRecent(null);
            open(look.id, folder);
            openThread(folder, message);
          }}
          onCompose={() => {
            setRecent(null);
            compose();
          }}
        />
      </MailPopover>
      <MailPopover
        visible={sheet === "mailboxes"}
        reading={hidden}
        align="left"
        onClose={() => setSheet(null)}
      >
        <MailboxesCard
          mailboxes={mailboxes}
          current={look.id}
          onPick={(id) => open(id, "INBOX")}
          onManage={() => {
            setSheet(null);
            router.push("/settings/mailboxes", { withAnchor: true });
          }}
        />
      </MailPopover>
      <MailPopover
        visible={sheet === "folders"}
        reading={hidden}
        align="right"
        onClose={() => setSheet(null)}
      >
        <PlacesCard
          mailbox={mailbox}
          labels={currentLabels}
          selected={label}
          onPick={(id) => open(look.id, id)}
          onSync={() => {
            setSheet(null);
            void syncNow();
          }}
        />
      </MailPopover>
      <LayoutAnimationConfig skipEntering>
        {selected ? (
          <Animated.View
            entering={barIn}
            exiting={barOut}
            pointerEvents="box-none"
            style={[styles.selectionBar, { bottom: insets.bottom + 6 }]}
          >
            <MenuButton
              accessibilityLabel={`${picked.length} selected`}
              sections={[
                [
                  {
                    title: picked.length === listed.length ? "Deselect all" : "Select all",
                    onPress: () =>
                      setSelected(
                        picked.length === listed.length
                          ? new Set()
                          : new Set(listed.map((message) => message.threadId)),
                      ),
                  },
                ],
              ]}
            >
              <Glass interactive style={styles.selectionCount}>
                <Text size="lg" color="primary">
                  {picked.length} selected
                </Text>
              </Glass>
            </MenuButton>
            <View style={{ flex: 1 }} />
            <Glass style={styles.selectionPill}>
              {agents ? (
                <MailButton
                  title="Send to agent"
                  disabled={!picked.length}
                  onPress={() => {
                    sendToAgent(picked.map((message) => mailPointer(account.email, message)));
                    setSelected(null);
                  }}
                >
                  <Icon name="sparkles" size={21} color="primary" />
                </MailButton>
              ) : null}
              {isBin || label === "ARCHIVE" ? (
                <MailButton
                  title="Move to Inbox"
                  disabled={!picked.length}
                  onPress={() => act("restore", picked, true)}
                >
                  <Icon name="tray.and.arrow.down" size={21} color="primary" />
                </MailButton>
              ) : (
                <MailButton
                  title="Archive"
                  disabled={!picked.some(actions.canArchive)}
                  onPress={() => act("archive", picked, true)}
                >
                  <Icon name="archivebox" size={21} color="primary" />
                </MailButton>
              )}
              <MenuButton
                accessibilityLabel="Message actions"
                sections={[
                  // oxlint-disable-next-line react/refs -- The actions read the list's ref when pressed.
                  selectionActions.map((action) => ({ ...action, disabled: !picked.length })),
                ]}
              >
                <View style={[styles.selectionIcon, { opacity: picked.length ? 1 : 0.35 }]}>
                  <Icon name="tag" size={21} color="primary" />
                </View>
              </MenuButton>
              <MailButton
                title={destructive === "discard" ? "Discard drafts" : destructiveTitle}
                disabled={!picked.length}
                onPress={() => act(destructive, picked, true)}
              >
                <Icon name="trash" size={21} color="primary" />
              </MailButton>
            </Glass>
          </Animated.View>
        ) : (
          <Animated.View
            entering={barIn}
            exiting={barOut}
            pointerEvents="box-none"
            style={StyleSheet.absoluteFill}
          >
            <MailBar
              mailbox={mailbox}
              label={label}
              reading={hidden && !isBenchmark}
              unread={
                Boolean(labels.data?.find(({ id }) => id === "INBOX")?.unread) ||
                (label === "INBOX" && all.some(unread))
              }
              onMailbox={() => {
                setRecent(null);
                setSheet(sheet === "mailboxes" ? null : "mailboxes");
              }}
              onLabel={(id) => open(look.id, id)}
              onFolders={() => {
                setRecent(null);
                setSheet(sheet === "folders" ? null : "folders");
              }}
              onSearch={() => router.push({ pathname: "/search", params: { account: look.id } })}
              onCompose={() => compose()}
              onSettings={() => router.push("/settings")}
              onRecents={(folder) => {
                setSheet(null);
                setRecent(folder);
              }}
            />
          </Animated.View>
        )}
      </LayoutAnimationConfig>
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

type RowHandlers = {
  act: (action: MailAction, entries: MessageSummary[]) => void;
  toggleSelection: (threadId: string) => void;
  toggleDay: (day: number) => void;
  rowMenu: (message: MessageSummary) => ReactNode;
  canArchive: (message: MessageSummary) => boolean;
  hasCode: (threadId: string) => boolean;
};

type RowContext = {
  look: string;
  accountId: string;
  label: string;
  own: string[];
  flagged: boolean;
  fullWidth: boolean;
  selected: Set<string> | null;
  collapsed: Set<number>;
  canvas: string;
  error: string;
  archive: string;
  restore: string;
  destructive: MailAction;
  destructiveTitle: string;
  latest: RefObject<RowHandlers>;
  keys: unknown[];
};

function renderRow({ item, target, extraData }: ListRenderItemInfo<Row>) {
  const context = extraData as RowContext;
  if ("day" in item)
    return (
      <DayHeader
        key={item.day}
        day={item.day}
        count={item.count}
        unread={item.unread}
        collapsed={context.collapsed.has(item.day)}
        sticky={target === "StickyHeader"}
        canvas={context.canvas}
        onToggle={() => context.latest.current.toggleDay(item.day)}
      />
    );
  const message = item.message;
  const { label, selected } = context;
  const handlers = context.latest.current;
  const isBin = label === "TRASH" || label === "SPAM";
  const canRestore = isBin || label === "ARCHIVE";
  const row = (
    <MailRow
      message={message}
      account={context.look}
      label={label}
      own={context.own}
      codeAccount={handlers.hasCode(message.threadId) ? context.accountId : undefined}
      trashCode={isBin ? undefined : () => handlers.act("trash", [message])}
      flagged={context.flagged}
      fullWidth={context.fullWidth}
      selected={selected?.has(message.threadId)}
      onSelect={selected ? () => handlers.toggleSelection(message.threadId) : undefined}
      leading={
        canRestore
          ? {
              title: "Move to Inbox",
              icon: "tray.and.arrow.down",
              tint: context.restore,
              onPerform: () => handlers.act("restore", [message]),
            }
          : handlers.canArchive(message)
            ? {
                title: "Archive",
                icon: "archivebox",
                tint: context.archive,
                onPerform: () => handlers.act("archive", [message]),
              }
            : undefined
      }
      trailing={{
        title: context.destructiveTitle,
        icon: "trash",
        tint: context.error,
        onPerform: () => handlers.act(context.destructive, [message]),
      }}
    />
  );
  if (selected) return row;
  return (
    <Link
      href={{
        pathname: "/mail/[account]/[label]/[thread]",
        params: { account: context.look, label, thread: message.threadId },
      }}
      asChild
    >
      <Link.Trigger withAppleZoom>{row}</Link.Trigger>
      {handlers.rowMenu(message)}
    </Link>
  );
}

/** A day's header: tap to fold its rows away, the chevron turning with them. */
function DayHeader({
  day,
  count,
  unread,
  collapsed,
  sticky,
  canvas,
  onToggle,
}: {
  day: number;
  count: number;
  unread: number;
  collapsed: boolean;
  sticky: boolean;
  canvas: string;
  onToggle: () => void;
}) {
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(collapsed ? "-90deg" : "0deg", { duration: 300 }) }],
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
      style={[styles.day, sticky ? { backgroundColor: canvas } : styles.dayGap]}
    >
      <Animated.View style={chevron}>
        <Icon name="chevron.down" size={9} color="mutedForeground" />
      </Animated.View>
      <Text size="body" weight="medium" style={{ flex: 1 }}>
        {dayLabel(day)}
      </Text>
      <Text size="body" color="mutedForeground" tabular>
        {count}
        {unread > 0 ? ` · ${unread} unread` : ""}
      </Text>
    </Pressable>
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
  },
  dayGap: { marginTop: 22 },
  more: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  done: { height: 44, paddingHorizontal: 18, justifyContent: "center" },
  selectionBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  selectionPill: { flexDirection: "row", alignItems: "center", padding: 2 },
  selectionCount: { justifyContent: "center", height: 48, paddingHorizontal: 18 },
  selectionIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
