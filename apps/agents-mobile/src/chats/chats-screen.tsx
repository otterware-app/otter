import { isProviderUsable, useAgentProviders } from "@otter/client/agents/agent-providers";
import { agentApi } from "@otter/client/agents/api";
import { useAutoSettleDays } from "@otter/client/agents/auto-settle";
import { bringBackChat, settleChat } from "@otter/client/agents/chat-actions";
import {
  agentNameOf,
  chatAgentOf,
  chatAgents,
  chatSearchResults,
  chatsWaitingOnYou,
  getChatAgentFilter,
  getChatShelf,
  newDraftChats,
  setChatAgentFilter,
  setChatShelf,
  type ListedShelf,
  unreadChats,
  useChatMessageSearch,
} from "@otter/client/agents/chat-list";
import { shelveChats, useNow } from "@otter/client/agents/chat-shelves";
import {
  deleteConversation,
  discardDraft,
  isBlank,
  markChatsSeen,
  showFoundMessage,
  useChats,
  type Conversation,
} from "@otter/client/agents/chat-store";
import { startup } from "@otter/mobile/start";
import { findTokenRanges, messageTokens, type SearchRange } from "@otter/shared/chat-search";
import { Chip } from "@otter/ui-native/components/chip";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { Toast } from "@otter/ui-native/components/toast";
import { haptics } from "@otter/ui-native/haptics";
import { useTheme } from "@otter/ui-native/theme";
import { FlashList } from "@shopify/flash-list";
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActionSheetIOS, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useHideBars } from "../frame/frame-store.ts";
import { openChat } from "../frame/navigation.ts";
import { useBottomBarInset } from "../frame/tab-root.tsx";
import { DraftRow, ListedChat, SearchedChat } from "./chat-list-rows.tsx";
import { SearchField } from "./search-field.tsx";
import { SelectionBar } from "./selection-bar.tsx";

type Item =
  | { kind: "chat"; chat: Conversation }
  | { kind: "draft"; chat: Conversation }
  | { kind: "more"; count: number }
  | { kind: "section"; title: string }
  | {
      kind: "found";
      chat: Conversation;
      ranges: readonly SearchRange[];
      excerpt?: { text: string; ranges: SearchRange[]; turnId: string };
    };

const PAGE = 25;

/**
 * Every chat, laid out as WhatsApp's Chats (ChatsScreen.swift): chips for the shelves (Active,
 * Snoozed, Settled), then a row a chat with its last message or what it's doing. ⋯ narrows the
 * list to one agent, and selects several chats to settle, mark read or delete at once.
 */
export function ChatsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const barInset = useBottomBarInset();
  const ready = useChats((s) => s.ready);
  const conversations = useChats((s) => s.conversations);
  const drafts = useChats((s) => s.drafts);
  const unseen = useChats((s) => s.unseen);
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const providers = useAgentProviders().data;
  const autoSettleDays = useAutoSettleDays();
  const now = useNow(30_000);

  const [shelf, setShelfState] = useState(getChatShelf);
  const [filter, setFilterState] = useState(getChatAgentFilter);
  const [settledShown, setSettledShown] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<Conversation[]>([]);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useHideBars(selecting);

  const setShelf = (next: ListedShelf) => {
    setChatShelf(next);
    setShelfState(next);
  };

  const setFilter = (key: string | null) => {
    setChatAgentFilter(key);
    setFilterState(key);
  };

  const listedAll = conversations.filter((c) => !isBlank(c));
  const agents = [...chatAgents(conversations)]
    .map(([key, a]) => ({ key, ...a, name: agentNameOf(providers, a.id, a.agent) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const filtered = agents.find((a) => a.key === filter);
  const listed = listedAll.filter((c) => !filter || chatAgentOf(c).key === filter);
  const needsYou = chatsWaitingOnYou({ runs, approvals, questions });
  const shelves = shelveChats(listed, {
    working: new Set(Object.keys(runs)),
    needsYou,
    now,
    autoSettleDays,
  });
  const active = [...shelves.pinned, ...shelves.active];
  const shown = shelf === "active" ? active : shelves[shelf];
  const unread = unreadChats({ unseen, runs, approvals, questions });
  const newDrafts =
    shelf === "active" && !filter && !selecting
      ? newDraftChats(conversations, drafts, { openId: "", openedWithDraft: false, agent: null })
      : [];
  const showsAgent = agents.length > 1 && !filter;
  const usable = (providers?.providers ?? []).filter(isProviderUsable);

  const needle = query.trim();
  const matches = useChatMessageSearch(needle).data;

  useEffect(() => {
    if (ready && listedAll.length > 0 && !startup.listShownAt) startup.listShownAt = Date.now();
  }, [ready, listedAll.length]);

  useEffect(() => {
    if (undo.length === 0) return;
    const timer = setTimeout(() => setUndo([]), 5000);
    return () => clearTimeout(timer);
  }, [undo]);

  const settle = (chats: Conversation[]) => {
    haptics.impact();
    for (const chat of chats) void settleChat(chat.id);
    setUndo(chats);
  };

  const endSelecting = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const toggle = (id: string) => {
    haptics.tap();
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const items: Item[] = needle
    ? searchItems(listedAll, needle, now, matches)
    : [
        ...newDrafts.map((chat) => ({ kind: "draft" as const, chat })),
        ...(shelf === "settled" ? shown.slice(0, settledShown) : shown).map((chat) => ({
          kind: "chat" as const,
          chat,
        })),
        ...(shelf === "settled" && shown.length > settledShown
          ? [{ kind: "more" as const, count: shown.length - settledShown }]
          : []),
      ];

  const deleteSelected = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Delete ${selected.size} chat${selected.size === 1 ? "" : "s"}?`,
        message: "They're deleted on every device.",
        options: ["Delete", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index !== 0) return;
        for (const chat of conversations.filter((c) => selected.has(c.id)))
          deleteConversation(chat.id, chat.provider);
        endSelecting();
      },
    );

  const header = needle ? null : (
    <View>
      {!selecting ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          <Chip
            text="Active"
            count={active.filter((c) => unread.has(c.id)).length}
            selected={shelf === "active"}
            onPress={() => setShelf("active")}
          />
          <Chip
            text="Snoozed"
            count={shelves.snoozed.length}
            selected={shelf === "snoozed"}
            onPress={() => setShelf("snoozed")}
          />
          <Chip
            text="Settled"
            count={shelves.settled.length}
            selected={shelf === "settled"}
            onPress={() => setShelf("settled")}
          />
          {filtered ? (
            <Chip
              text={filtered.name}
              selected
              removable
              leading={<AgentAvatar agent={filtered.id} gatewayAgent={filtered.agent} size={14} />}
              accessibilityLabel={`${filtered.name}, show all agents`}
              onPress={() => setFilter(null)}
            />
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: selecting
            ? selected.size === 0
              ? "Select chats"
              : `${selected.size} selected`
            : "",
        }}
      />
      {selecting ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="checkmark"
            variant="prominent"
            tintColor={theme.colors.primary}
            onPress={endSelecting}
          >
            Done
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.View hidesSharedBackground>
              <View
                style={{ flexDirection: "row", gap: 5 }}
                accessible
                accessibilityRole="header"
                accessibilityLabel="Otter Agents"
              >
                <Text size="xl" weight="medium" style={{ letterSpacing: -0.5 }}>
                  Otter
                </Text>
                <Text
                  size="xl"
                  weight="medium"
                  color="mutedForeground"
                  style={{ letterSpacing: -0.5 }}
                >
                  Agents
                </Text>
              </View>
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            {searching ? (
              <Stack.Toolbar.Button
                icon="xmark"
                accessibilityLabel="Close search"
                onPress={() => {
                  setSearching(false);
                  setQuery("");
                }}
              />
            ) : (
              <Stack.Toolbar.Button
                icon="magnifyingglass"
                accessibilityLabel="Search chats"
                onPress={() => setSearching(true)}
              />
            )}
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
              <Stack.Toolbar.MenuAction icon="checkmark.circle" onPress={() => setSelecting(true)}>
                Select chats
              </Stack.Toolbar.MenuAction>
              {unseen.size > 0 ? (
                <Stack.Toolbar.MenuAction
                  icon="checkmark.message"
                  onPress={() => markChatsSeen(unseen)}
                >
                  Read all
                </Stack.Toolbar.MenuAction>
              ) : null}
              {agents.length > 1 || filter ? (
                <Stack.Toolbar.Menu icon="person.2" title="Agent">
                  <Stack.Toolbar.MenuAction isOn={!filter} onPress={() => setFilter(null)}>
                    All agents
                  </Stack.Toolbar.MenuAction>
                  {agents.map((agent) => (
                    <Stack.Toolbar.MenuAction
                      key={agent.key}
                      isOn={filter === agent.key}
                      onPress={() => setFilter(agent.key)}
                    >
                      {`${agent.name} (${agent.count})`}
                    </Stack.Toolbar.MenuAction>
                  ))}
                </Stack.Toolbar.Menu>
              ) : null}
              {usable.length > 0 ? (
                <Stack.Toolbar.MenuAction icon="tray.full" onPress={() => router.push("/sessions")}>
                  On your agents
                </Stack.Toolbar.MenuAction>
              ) : null}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      )}
      <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
        <FlashList
          data={ready ? items : []}
          keyExtractor={(item) =>
            item.kind === "more" ? "more" : item.kind === "section" ? item.title : item.chat.id
          }
          getItemType={(item) => item.kind}
          maintainVisibleContentPosition={{ disabled: true }}
          extraData={{ selecting, selected, now, showsAgent, shelf }}
          contentInsetAdjustmentBehavior="automatic"
          contentInset={{ bottom: barInset }}
          scrollIndicatorInsets={{ bottom: barInset }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void agentApi.refreshProviders().finally(() => setRefreshing(false));
              }}
            />
          }
          ListHeaderComponent={
            <>
              {searching ? (
                <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
                  <SearchField prompt="Search chats" text={query} onChange={setQuery} autoFocus />
                </View>
              ) : null}
              {header}
            </>
          }
          ListEmptyComponent={
            needle ? (
              <Empty title="No results" line={`No chats matching “${needle}”`} top={80} />
            ) : newDrafts.length > 0 ? null : (
              <ShelfEmpty
                ready={ready}
                shelf={shelf}
                filtered={Boolean(filter)}
                showAll={() => setFilter(null)}
                agentsAdded={(providers?.providers.length ?? 0) > 0}
                agentsUsable={usable.length > 0}
              />
            )
          }
          renderItem={({ item }) => {
            switch (item.kind) {
              case "section":
                return (
                  <Text
                    size="md"
                    weight="semibold"
                    accessibilityRole="header"
                    style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}
                  >
                    {item.title}
                  </Text>
                );
              case "more":
                return (
                  <Pressable
                    onPress={() => setSettledShown((n) => n + PAGE)}
                    accessibilityRole="button"
                    style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text size="md" weight="medium" color="primary">
                      Show {item.count} more
                    </Text>
                  </Pressable>
                );
              case "draft":
                return (
                  <DraftRow
                    chat={item.chat}
                    draft={drafts[item.chat.id] ?? ""}
                    discard={() => discardDraft(item.chat.id)}
                  />
                );
              case "found":
                return (
                  <SearchedChat
                    chat={item.chat}
                    now={now}
                    showAgent={showsAgent}
                    titleRanges={item.ranges}
                    excerpt={item.excerpt}
                    open={() => {
                      if (item.excerpt)
                        showFoundMessage({ turnId: item.excerpt.turnId, query: needle });
                      openChat(item.chat.id);
                    }}
                  />
                );
              case "chat":
                return (
                  <ListedChat
                    chat={item.chat}
                    now={now}
                    showAgent={showsAgent}
                    shelf={shelf}
                    selecting={selecting}
                    picked={selected.has(item.chat.id)}
                    toggle={() => toggle(item.chat.id)}
                    unread={unseen.has(item.chat.id)}
                    settle={() => settle([item.chat])}
                    settled={(chat) => setUndo([chat])}
                  />
                );
            }
          }}
        />
      </View>
      {selecting ? (
        <Animated.View
          entering={SlideInDown.duration(200)}
          exiting={SlideOutDown.duration(200)}
          style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 4 }}
        >
          <SelectionBar
            disabled={selected.size === 0}
            canRead={[...selected].some((id) => unseen.has(id))}
            settle={() => {
              settle(conversations.filter((c) => selected.has(c.id)));
              endSelecting();
            }}
            read={() => {
              markChatsSeen(selected);
              endSelecting();
            }}
            remove={deleteSelected}
          />
        </Animated.View>
      ) : undo.length > 0 ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(200)}
          style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + barInset + 8 }}
        >
          <Toast
            text={undo.length === 1 ? "Settled chat" : `Settled ${undo.length} chats`}
            action={{
              label: "Undo",
              run: () => {
                for (const chat of undo) void bringBackChat(chat.id);
                setUndo([]);
              },
            }}
          />
        </Animated.View>
      ) : null}
    </>
  );
}

/** T3 Code's sidebar search: titles first, best on top, then chats one of whose messages says it. */
function searchItems(
  chats: Conversation[],
  query: string,
  now: number,
  matches: Parameters<typeof chatSearchResults>[3],
): Item[] {
  const results = chatSearchResults(chats, query, now, matches);
  const titled = results.filter((r) => !r.match);
  const said = results.filter((r) => r.match);
  const tokens = messageTokens(query);
  return [
    ...(titled.length > 0 ? [{ kind: "section" as const, title: "Chats" }] : []),
    ...titled.map((r) => ({ kind: "found" as const, chat: r.chat, ranges: r.ranges })),
    ...(said.length > 0 ? [{ kind: "section" as const, title: "Messages" }] : []),
    ...said.map((r) => {
      const match = r.match!;
      const text = `${match.role === "user" ? "You" : "Agent"}: ${match.snippet}`;
      return {
        kind: "found" as const,
        chat: r.chat,
        ranges: r.ranges,
        excerpt: { text, ranges: findTokenRanges(text, tokens), turnId: match.turnId },
      };
    }),
  ];
}

function Empty({
  title,
  line,
  top = 120,
  children,
}: {
  title: string;
  line?: string;
  top?: number;
  children?: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: 8, paddingHorizontal: 32, paddingTop: top }}>
      <Text size="xl" weight="semibold" accessibilityRole="header" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {line ? (
        <Text size="base" color="mutedForeground" style={{ textAlign: "center" }}>
          {line}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function ShelfEmpty({
  ready,
  shelf,
  filtered,
  showAll,
  agentsAdded,
  agentsUsable,
}: {
  ready: boolean;
  shelf: ListedShelf;
  filtered: boolean;
  showAll: () => void;
  agentsAdded: boolean;
  agentsUsable: boolean;
}) {
  const theme = useTheme();
  if (!ready)
    return (
      <View style={{ paddingTop: 120 }}>
        <Spinner />
      </View>
    );
  if (shelf === "snoozed")
    return <Empty title="Nothing snoozed" line="Snooze a chat to put it away until later." />;
  if (shelf === "settled")
    return (
      <Empty title="Nothing settled" line="Settled chats come back when there's news in them." />
    );
  if (filtered)
    return (
      <Empty title="No active chats">
        <Pressable onPress={showAll} accessibilityRole="button" hitSlop={8}>
          <Text size="base" color="mutedForeground">
            Show all agents
          </Text>
        </Pressable>
      </Empty>
    );
  if (!agentsUsable)
    return (
      <Empty
        title={agentsAdded ? "Connect an agent" : "Add an agent"}
        line="Chats run on your agents: Hermes, OpenClaw or varys, as many as you like. Add them in Settings › Agents."
      >
        <Pressable
          onPress={() => router.navigate("/settings")}
          accessibilityRole="button"
          style={{
            marginTop: 8,
            height: 42,
            paddingHorizontal: 20,
            borderRadius: 21,
            justifyContent: "center",
            backgroundColor: theme.colors.primary,
          }}
        >
          <Text size="md" weight="semibold" color="primaryForeground">
            Open Settings
          </Text>
        </Pressable>
      </Empty>
    );
  return <Empty title="No chats yet" line="Chats you start show up here." />;
}
