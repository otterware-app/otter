import {
  canRunChat,
  canStartChat,
  disabledAgents,
  openClawAgentId,
  useAgentProviders,
} from "@otter/client/agents/agent-providers";
import type { ProvidersState } from "@otter/client/agents/api";
import { addCitation } from "@otter/client/agents/chat-cite";
import { findTurns } from "@otter/client/agents/chat-find";
import { isChatFileLink } from "@otter/client/agents/chat-links";
import { agentNameOf, isDetached } from "@otter/client/agents/chat-list";
import { layoutReplies } from "@otter/client/agents/chat-runs";
import {
  canReconnect,
  forkChat,
  isBlank,
  isCompacting,
  isElsewhere,
  loadChat,
  openChatTab,
  reconnectChat,
  reconnectTargets,
  showChat,
  showFoundMessage,
  useChats,
  watchChat,
  type Conversation,
} from "@otter/client/agents/chat-store";
import { turnDay } from "@otter/client/agents/chat-time";
import { callTurns, transcriptRows, type TranscriptRow } from "@otter/client/agents/transcript";
import { Button } from "@otter/ui-native/components/button";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import * as Linking from "expo-linking";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  ActionSheetIOS,
  Alert,
  Keyboard,
  Pressable,
  TextInput,
  View,
  type NativeScrollEvent,
  type ScrollViewProps,
} from "react-native";
import {
  KeyboardChatScrollView,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useChatAgent } from "./chat-agent.ts";
import { ChatHeader, leaveChat } from "./chat-header.tsx";
import { FindBar } from "./find-bar.tsx";
import { ComposerPanelContext } from "./composer-panel.ts";
import { ChatFooter } from "./footer.tsx";
import { ChatTextContext } from "./markdown.tsx";
import { AssistantTurn, DayPill, UserTurn, type Live } from "./transcript.tsx";
import {
  leaveVoice,
  useVoice,
  useVoiceGreeting,
  VOICE_FOOT_HEIGHT,
  VOICE_SWAP,
  VoiceEnded,
  VoiceMode,
} from "./voice-mode.tsx";

const Footer = createContext<{
  height: SharedValue<number>;
  bottom: number;
  onEnd: (visible: boolean) => void;
} | null>(null);

/**
 * The transcript's scroll view: it makes room for the footer and the keyboard under its end,
 * lifts the end with the keyboard when it's in view, and dragging down takes the keyboard with the finger.
 */
function TranscriptScroll(props: ScrollViewProps) {
  const footer = use(Footer);
  return (
    <KeyboardChatScrollView
      {...props}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      keyboardLiftBehavior="always"
      offset={footer?.bottom}
      extraContentPadding={footer?.height}
      onEndVisible={footer?.onEnd}
    />
  );
}

type Item = {
  row: TranscriptRow;
  day: string | null;
  gap: number;
  joinsAbove: boolean;
  joinsBelow: boolean;
  answered: number;
  continued: boolean;
};

const itemKey = (item: Item) => item.row.turn.id;
const itemType = (item: Item) => item.row.kind;
const fromBottom = { startRenderingFromBottom: true };

/** The transcript is scrolled all the way down, give or take a few points. */
const atBottom = ({
  contentOffset,
  contentSize,
  contentInset,
  layoutMeasurement,
}: NativeScrollEvent) =>
  contentSize.height + (contentInset?.bottom ?? 0) - contentOffset.y - layoutMeasurement.height <
  24;

/** A chat: the transcript under its header, and the composer over its end (ChatScreen.swift). */
export function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useChats((s) => s.conversations.find((c) => c.id === id));
  const ready = useChats((s) => s.ready);
  const exists = chat !== undefined;
  useEffect(() => {
    if (ready && !exists) leaveChat();
  }, [ready, exists]);
  useFocusEffect(
    useCallback(() => {
      watchChat(id);
      showChat(id);
      return () => watchChat(null);
    }, [id]),
  );
  const loaded = chat?.loaded;
  useEffect(() => {
    if (loaded === false) void loadChat(id);
  }, [loaded, id]);
  return chat ? <Chat key={chat.id} chat={chat} /> : null;
}

function Chat({ chat }: { chat: Conversation }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const id = chat.id;
  const agents = useAgentProviders().data;
  const run = useChats((s) => s.runs[id]);
  const asking = useChats((s) =>
    Boolean(
      run &&
      (s.approvals.some((a) => a.requestId === run.requestId) ||
        s.questions.some((q) => q.requestId === run.requestId)),
    ),
  );
  const hydrating = useChats((s) => s.hydrating === id);
  const device = useChats((s) => s.device);
  const found = useChats((s) => s.found);
  const lastId = chat.turns.at(-1)?.id ?? "";
  const retryable = useChats((s) => s.retries[lastId] !== undefined);
  const detached = isDetached({ runs: run ? { [id]: run } : {} }, chat);
  const voice = useVoice((s) => s.open?.chatId === id);
  useEffect(() => () => leaveVoice(id), [id]);

  const list = useRef<FlashListRef<Item>>(null);
  const composer = useRef<ComponentRef<typeof TextInput>>(null);
  const viewport = useRef(0);
  const footerHeight = useSharedValue(insets.bottom);
  const keyboard = useComposerPosition(insets.bottom, footerHeight);
  const atEnd = useSharedValue(true);
  // What's written keeps the end in view until you scroll away from it, and again once you're
  // back. Not FlashList's autoscroll: the flag it sets near the end outlives the drag that leaves it.
  const following = useRef(true);
  const dragging = useRef(false);
  const settle = (e: { nativeEvent: NativeScrollEvent }) => {
    if (!dragging.current) return;
    dragging.current = false;
    following.current = atBottom(e.nativeEvent);
  };
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [findAt, setFindAt] = useState(0);

  const provider = agents?.providers.find((p) => p.id === chat.provider);
  const gatewayAgent = openClawAgentId(chat.sessionId);
  const name = agentNameOf(agents, chat.provider, gatewayAgent);
  const canWrite = !isElsewhere(chat, device) && canRunChat(provider, chat.sessionId);
  const live: Live | null = run
    ? isCompacting(chat.turns)
      ? "compacting"
      : run.waiting
        ? "waiting"
        : "working"
    : null;

  const turns = useMemo(() => callTurns(chat.turns), [chat.turns]);
  const streaming = Boolean(run);
  const waiting = Boolean(run?.waiting);
  const items = useMemo(
    () =>
      transcriptItems(turns, {
        streaming,
        asking,
        waiting,
        detached,
        retryable,
      }),
    [turns, streaming, waiting, asking, detached, retryable],
  );

  const matches = useMemo(
    () => (finding && query.trim() ? findTurns(turns, query) : []),
    [finding, turns, query],
  );
  const foundIndex = found ? turns.findIndex((turn) => turn.id === found.turnId) : -1;
  const foundId = foundIndex >= 0 ? found?.turnId : undefined;
  const { covered } = keyboard;
  const scrollToTurn = useCallback(
    (index: number, animated: boolean) => {
      const ref = list.current;
      const layout = ref?.getLayout(index);
      if (!ref || !layout) return;
      const top = ref.getFirstItemOffset() + layout.y;
      const offset = ref.getAbsoluteLastScrollOffset();
      const above = headerHeight + FIND_BAR;
      const bottom = viewport.current - covered();
      const y =
        layout.height > bottom - above || top < offset + above
          ? top - above
          : Math.max(offset, top + layout.height - bottom);
      if (y === offset) return;
      // What's found stays in view: what's written next doesn't pull the chat back to its end.
      following.current = false;
      ref.scrollToOffset({ offset: y, animated, skipFirstItemOffset: true });
    },
    [covered, headerHeight],
  );
  const findAnimated = useRef(false);
  const go = (step: 1 | -1) => {
    if (!matches.length) return;
    const next = (Math.min(findAt, matches.length - 1) + step + matches.length) % matches.length;
    setFindAt(next);
    findAnimated.current = true;
    showFoundMessage({ turnId: matches[next], query });
  };
  const find = (text: string) => {
    setQuery(text);
    setFindAt(0);
    findAnimated.current = false;
    const first = text.trim() ? findTurns(turns, text)[0] : undefined;
    showFoundMessage(first ? { turnId: first, query: text } : null);
  };
  const endFind = useCallback(() => {
    setFinding(false);
    setQuery("");
    showFoundMessage(null);
  }, []);
  useEffect(() => {
    if (!finding || foundIndex < 0) return;
    let active = true;
    const correct = () => {
      if (active) scrollToTurn(foundIndex, false);
    };
    let layoutFrame = 0;
    const frame = requestAnimationFrame(() => {
      layoutFrame = requestAnimationFrame(() => {
        const ref = list.current;
        if (ref?.getLayout(foundIndex)?.isHeightMeasured) {
          scrollToTurn(foundIndex, findAnimated.current);
        } else {
          following.current = false;
          void ref?.scrollToIndex({ index: foundIndex, animated: false }).then(correct);
        }
      });
    });
    const keyboardShown = Keyboard.addListener("keyboardDidShow", correct);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(layoutFrame);
      keyboardShown.remove();
    };
  }, [finding, foundIndex, scrollToTurn]);

  // A chat opened from the chats list's search lands on the message it found.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || finding || foundIndex < 0 || !chat.loaded) return;
    const timer = setTimeout(() => {
      arrived.current = true;
      following.current = false;
      void list.current?.scrollToIndex({ index: foundIndex, animated: true, viewPosition: 0.5 });
    }, 250);
    return () => clearTimeout(timer);
  }, [finding, foundIndex, chat.loaded]);
  useEffect(() => () => showFoundMessage(null), []);

  const open = useCallback(
    (href: string) => {
      if (/^https?:/i.test(href)) {
        openChatTab(id, { kind: "page", url: href }, hostOf(href));
        void WebBrowser.openBrowserAsync(href, {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        });
      } else if (isChatFileLink(href)) {
        const path = decodeURI(href);
        openChatTab(id, { kind: "file", href: path }, path.split("/").pop() || path);
        router.push({ pathname: "/agents/[id]/file", params: { id, path } });
      } else void Linking.openURL(href);
    },
    [id],
  );

  const fork = useCallback(
    async (turnId: string) => {
      const forked = await forkChat(id, turnId);
      if (forked) router.replace({ pathname: "/agents/[id]", params: { id: forked } });
    },
    [id],
  );

  const quote = useCallback(
    (quoted: string, source?: string) => {
      if (!quoted) return;
      const citations = useChats.getState().citations[id];
      if (!citations?.some((citation) => citation.text === quoted)) addCitation(id, quoted, source);
      if (finding) endFind();
      composer.current?.focus();
    },
    [id, finding, endFind],
  );

  const marks = finding ? query : foundId ? (found?.query ?? "") : "";
  const text = useMemo(
    () => ({
      open,
      quote: canWrite ? quote : undefined,
      find: marks,
    }),
    [open, canWrite, quote, marks],
  );
  const footer = useMemo(
    () => ({
      height: keyboard.padding,
      bottom: insets.bottom,
      onEnd: (visible: boolean) => {
        "worklet";
        atEnd.set(visible);
      },
    }),
    [keyboard.padding, insets.bottom, atEnd],
  );
  const canFork = Boolean(provider?.forks && chat.sessionId) && canWrite;
  const renderItem = useCallback(
    ({ item }: { item: Item }) => (
      <TranscriptItem
        item={item}
        name={name}
        live={item.row.kind === "reply" && item.row.live ? live : null}
        found={foundId === item.row.turn.id}
        canFork={canFork}
        onFork={fork}
      />
    ),
    [name, live, foundId, canFork, fork],
  );
  const beginFind = useCallback(() => setFinding(true), []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      <ChatHeader chat={chat} agents={agents} onFind={beginFind} />
      <ChatTextContext value={text}>
        <Footer value={footer}>
          <FlashList
            ref={list}
            onLayout={(e) => {
              viewport.current = e.nativeEvent.layout.height;
            }}
            data={items}
            keyExtractor={itemKey}
            getItemType={itemType}
            renderItem={renderItem}
            renderScrollComponent={TranscriptScroll}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{ paddingTop: 12 + (finding ? FIND_BAR : 0) }}
            initialScrollIndex={items.length > 0 ? items.length - 1 : undefined}
            maintainVisibleContentPosition={fromBottom}
            onContentSizeChange={() => {
              if (following.current && !finding) list.current?.scrollToEnd({ animated: false });
            }}
            onScrollBeginDrag={() => {
              dragging.current = true;
              following.current = false;
            }}
            onScrollEndDrag={(e) => {
              if (!e.nativeEvent.velocity?.y) settle(e);
            }}
            onMomentumScrollEnd={settle}
          />
        </Footer>
      </ChatTextContext>
      {finding ? (
        <View style={{ position: "absolute", top: headerHeight + 6, left: 0, right: 0 }}>
          <FindBar
            query={query}
            onChange={find}
            at={findAt}
            found={matches.length}
            onGo={go}
            onDone={endFind}
          />
        </View>
      ) : null}
      <Placeholder chat={chat} hydrating={hydrating} />
      <Animated.View
        style={[{ position: "absolute", left: 0, right: 0, bottom: 0 }, keyboard.lift]}
      >
        <VoiceEnded chatId={id} />
        {turns.length > 0 && !voice ? (
          <JumpToLatest
            atEnd={atEnd}
            onPress={() => {
              following.current = true;
              list.current?.scrollToEnd({ animated: true });
            }}
          />
        ) : null}
        <View
          style={{ paddingBottom: insets.bottom }}
          onLayout={(e) => {
            footerHeight.set(e.nativeEvent.layout.height);
            // What the agent asks takes the composer's place, taller: the end stays in view.
            if (!finding && atEnd.get())
              requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false }));
          }}
        >
          {voice ? (
            <View style={{ height: VOICE_FOOT_HEIGHT }} />
          ) : canWrite ? (
            // The composer sinks away as a call takes its place, and comes back as it ends.
            <Animated.View
              entering={FadeInDown.duration(VOICE_SWAP.duration).easing(VOICE_SWAP.easing)}
              exiting={FadeOutDown.duration(VOICE_SWAP.duration).easing(VOICE_SWAP.easing)}
            >
              <ComposerPanelContext value={keyboard.panel}>
                <ChatFooter chatId={id} input={composer} />
              </ComposerPanelContext>
            </Animated.View>
          ) : (
            <ReadOnly chat={chat} agents={agents} />
          )}
        </View>
      </Animated.View>
      {voice ? <VoiceMode chatId={id} /> : null}
    </View>
  );
}

function useComposerPosition(bottom: number, footerHeight: SharedValue<number>) {
  const { height, progress } = useReanimatedKeyboardAnimation();
  const [open, setOpenState] = useState(false);
  const panelHeight = useSharedValue(0);
  const keyboardLift = useDerivedValue(() => Math.max(0, -height.get() - bottom * progress.get()));

  const setOpen = useCallback(
    (now: boolean) => {
      setOpenState(now);
      if (now) Keyboard.dismiss();
      else panelHeight.set(0);
    },
    [panelHeight],
  );

  useEffect(() => {
    if (!open) return;
    const shown = Keyboard.addListener("keyboardDidShow", () => setOpen(false));
    return () => shown.remove();
  }, [open, setOpen]);

  const panel = useMemo(
    () => ({ open, setOpen, setHeight: (height: number) => panelHeight.set(height) }),
    [open, setOpen, panelHeight],
  );
  // The attachment tray already lifts the input by its own height. Only add the
  // part of the keyboard that rises above the tray while the two are switching.
  const liftBy = useDerivedValue(() => Math.max(0, keyboardLift.get() - panelHeight.get()));
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -liftBy.get() }],
  }));
  const padding = useDerivedValue(
    () => footerHeight.get() - Math.min(keyboardLift.get(), panelHeight.get()),
  );
  const covered = useCallback(() => footerHeight.get() + liftBy.get(), [footerHeight, liftBy]);
  return { panel, padding, lift, covered };
}

/** Find in chat's bar, over the transcript: what it goes to shows under it. */
const FIND_BAR = 56;

type ItemProps = {
  item: Item;
  name: string;
  live: Live | null;
  found: boolean;
  canFork: boolean;
  onFork: (turnId: string) => Promise<void>;
};

/** Unchanged turns keep their row: a reply streaming in redraws only itself. */
const unchanged = (a: ItemProps, b: ItemProps) => {
  const [x, y] = [a.item, b.item];
  const [r, s] = [x.row, y.row];
  return (
    r.turn === s.turn &&
    x.day === y.day &&
    x.gap === y.gap &&
    x.joinsAbove === y.joinsAbove &&
    x.joinsBelow === y.joinsBelow &&
    x.answered === y.answered &&
    x.continued === y.continued &&
    a.name === b.name &&
    a.live === b.live &&
    a.found === b.found &&
    a.canFork === b.canFork &&
    a.onFork === b.onFork &&
    (r.kind === "message" && s.kind === "message"
      ? r.waiting === s.waiting && r.steered === s.steered
      : r.kind === "reply" &&
        s.kind === "reply" &&
        r.live === s.live &&
        r.detached === s.detached &&
        r.retry === s.retry &&
        r.showsChanges === s.showsChanges &&
        r.layout?.fold?.label === s.layout?.fold?.label)
  );
};

const TranscriptItem = memo(function TranscriptItem({
  item,
  name,
  live,
  found,
  canFork,
  onFork,
}: ItemProps) {
  const theme = useTheme();
  const { row } = item;
  const fork = useCallback(() => void onFork(row.turn.id), [onFork, row.turn.id]);
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingBottom: item.gap,
        backgroundColor: found ? alpha(theme.colors.primary, 0.07) : undefined,
      }}
    >
      {item.day ? (
        <View style={{ paddingBottom: item.gap }}>
          <DayPill text={item.day} />
        </View>
      ) : null}
      {row.kind === "message" ? (
        <UserTurn
          row={row}
          answered={item.answered}
          joinsAbove={item.joinsAbove}
          joinsBelow={item.joinsBelow}
        />
      ) : (
        <AssistantTurn
          row={row}
          name={name}
          live={live}
          continued={item.continued}
          found={found}
          canFork={canFork}
          onFork={fork}
        />
      )}
    </View>
  );
}, unchanged);

function transcriptItems(
  turns: Conversation["turns"],
  {
    streaming,
    asking,
    waiting,
    detached,
    retryable,
  }: {
    streaming: boolean;
    asking: boolean;
    waiting: boolean;
    detached: boolean;
    retryable: boolean;
  },
): Item[] {
  const rows = transcriptRows(turns, layoutReplies(turns, { streaming, asking, waiting }), {
    streaming,
    detached,
    retryable,
    expanded: new Set(),
  });
  let previous: { startedAt?: number } = {};
  const now = Date.now();
  const days = turns.map((turn) => {
    const day = turnDay([previous, turn], 1, now);
    if (turn.startedAt !== undefined) previous = turn;
    return day;
  });
  const items: Item[] = [];
  let answered = 0;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    const turn = row.turn;
    const next = turns[index + 1];
    items[index] = {
      row,
      day: days[index],
      gap: next?.role === turn.role ? 4 : 12,
      joinsAbove: index > 0 && turns[index - 1].role === "user",
      joinsBelow: next?.role === "user",
      answered: turn.role === "user" ? answered : 0,
      continued:
        index > 0 &&
        (turns[index - 1].intent === "steer" || turns[index - 1].intent === "promoted"),
    };
    if (turn.role === "assistant") answered = turn.finishedAt ? 2 : 1;
  }
  return items;
}

const hostOf = (url: string) => /^https?:\/\/(?:www\.)?([^/:?#]+)/i.exec(url)?.[1] ?? url;

/** Back to the end of the conversation, over its end while you read further up. */
function JumpToLatest({ atEnd, onPress }: { atEnd: SharedValue<boolean>; onPress: () => void }) {
  const shown = useAnimatedStyle(() => ({ display: atEnd.get() ? "none" : "flex" }));
  return (
    <Animated.View style={[{ alignItems: "center", paddingBottom: 8 }, shown]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to latest"
        onPress={() => {
          haptics.tap();
          onPress();
        }}
      >
        <Glass
          shape="circle"
          interactive
          style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="chevron.down" size={14} weight="semibold" />
        </Glass>
      </Pressable>
    </Animated.View>
  );
}

/** Loading, and an empty chat's "What can I help with?", over the transcript. */
function Placeholder({ chat, hydrating }: { chat: Conversation; hydrating: boolean }) {
  const { id: agent, provider, gatewayAgent, label } = useChatAgent(chat.id);
  const greeting = useVoiceGreeting(chat.id);
  if (!chat.loaded || hydrating)
    return (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        <Spinner />
        {hydrating ? (
          <Text size="sm" color="mutedForeground">
            Loading this session from {provider?.name ?? "Agent"}…
          </Text>
        ) : null}
      </View>
    );
  if (!isBlank(chat)) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        inset: 0,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        paddingHorizontal: 32,
        paddingBottom: 80,
      }}
    >
      {greeting ? <AgentAvatar agent={agent} gatewayAgent={gatewayAgent} size={28} /> : null}
      <Text size="2xl" weight="medium" style={{ fontSize: 26, letterSpacing: -0.5 }}>
        {greeting ?? "What can I help with?"}
      </Text>
      {greeting ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/agents/[id]/model", params: { id: chat.id } })}
          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <AgentAvatar agent={agent} gatewayAgent={gatewayAgent} size={18} />
          <Text size="sm" color="mutedForeground">
            {provider ? `with ${label}` : "Add an agent in Settings › Agents"}
          </Text>
          <Icon name="chevron.right" size={10} weight="semibold" color="mutedForeground" />
        </Pressable>
      )}
    </View>
  );
}

/** Why this chat only reads here, and where it goes on (ChatScreen.swift's `readOnly`). */
function ReadOnly({ chat, agents }: { chat: Conversation; agents: ProvidersState | undefined }) {
  const device = useChats((s) => s.device);
  const running = useChats((s) => Boolean(s.runs[chat.id]));
  const provider = agents?.providers.find((p) => p.id === chat.provider);
  const other = agents?.others.find((o) => o.id === chat.provider);
  const name = provider?.name ?? other?.name ?? "its agent";
  const settings = () =>
    provider
      ? router.navigate({ pathname: "/settings/agents/[id]", params: { id: provider.id } })
      : router.navigate("/settings/agents");
  let text: string;
  let action: { title: string; onPress: () => void } | null = null;
  if (isElsewhere(chat, device)) {
    text = `This chat ran in ${name} on ${chat.device?.name ?? "a Mac"}. Continue it there.`;
  } else if (isBlank(chat) && !provider) {
    text = "Chats run on your agents. Add one in Settings › Agents.";
    action = { title: "Open Settings", onPress: settings };
  } else if (provider) {
    const agent = openClawAgentId(chat.sessionId);
    const enabled =
      provider.enabled &&
      (agent ? !disabledAgents(provider).includes(agent) : canStartChat(provider));
    text = enabled
      ? `${name} isn't connected on this iPhone.`
      : `${name} is turned off on this iPhone.`;
    action = {
      title: enabled && provider.kind === "openclaw" ? "Connect on this iPhone" : "Open Settings",
      onPress: settings,
    };
  } else if (!other) {
    text = "This chat's agent was removed.";
    if (agents && !running && canReconnect({ runs: {}, device }, chat, agents.providers))
      action = { title: "Reconnect agent", onPress: () => reconnect(chat, agents) };
  } else {
    text = `This chat runs on ${name}, which this iPhone can't reach.`;
  }
  return (
    <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 28, paddingVertical: 14 }}>
      <Text size="sm" color="mutedForeground" style={{ textAlign: "center" }}>
        {text}
      </Text>
      {action ? (
        <Button
          title={action.title}
          variant="secondary"
          size="sm"
          style={{ alignSelf: "center" }}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}

/** ReconnectAgentSheet.swift as the system's sheet of choices: the OpenClaw gateways that work here. */
function reconnect(chat: Conversation, agents: ProvidersState) {
  const gateways = reconnectTargets(agents.providers);
  if (gateways.length === 0) {
    Alert.alert(
      "Reconnect agent",
      "Connect the OpenClaw gateway this chat ran on, then come back here.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => router.navigate("/settings/agents") },
      ],
    );
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Reconnect agent",
      message: "Choose the OpenClaw gateway this chat ran on. Its session and messages stay.",
      options: [...gateways.map((g) => g.name), "Cancel"],
      cancelButtonIndex: gateways.length,
    },
    (index) => {
      const gateway = gateways[index];
      if (!gateway) return;
      reconnectChat(chat.id, gateway).catch((error: unknown) =>
        Alert.alert("Couldn't reconnect", error instanceof Error ? error.message : String(error)),
      );
    },
  );
}
