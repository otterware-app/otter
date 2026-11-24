import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { scheduledSummary, useScheduledTasks } from "@otter/client/agents/agent-scheduled";
import { unreadChats } from "@otter/client/agents/chat-list";
import { useChats } from "@otter/client/agents/chat-store";
import { Badge } from "@otter/ui-native/components/badge";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import {
  GestureDetector,
  useCompetingGestures,
  useLongPressGesture,
  usePanGesture,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { showCard } from "./frame-store.ts";
import { useAsk } from "./navigation.ts";
import { TABS, type Tab } from "./tabs.ts";

/** BottomBar.swift's: the row of tabs. */
export const TABS_HEIGHT = 44;
const ASK_HEIGHT = 48;
const TOP = 8;
const GAP = 6;
/** What the bars take above the safe area. */
export const BAR_HEIGHT = TOP + ASK_HEIGHT + GAP + TABS_HEIGHT;

/**
 * Claude's bottom (BottomBar.swift): the bar to ask an agent, and under it the tabs, a slim row
 * of icons on the canvas with a soft pill behind the one you're on.
 */
export function BottomBar({ tab, hidden }: { tab: Tab; hidden: boolean }) {
  const insets = useSafeAreaInsets();
  const shown = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    shown.set(withTiming(hidden ? 0 : 1, { duration: 200 }));
  }, [hidden, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * 40 }],
  }));
  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "box-none"}
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingTop: TOP,
          paddingBottom: insets.bottom,
        },
        style,
      ]}
    >
      <BarBacking />
      <View style={{ paddingHorizontal: 16, zIndex: 1 }}>
        <AskBar />
      </View>
      <View style={{ height: GAP }} />
      <TabRow tab={tab} />
    </Animated.View>
  );
}

/**
 * The canvas behind the tabs (Palette.swift's `BarBacking`), from under the ask bar to the
 * screen's edge, fading in over 10pt, so the list ends under the bars.
 */
function BarBacking() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        top: TOP + ASK_HEIGHT + GAP - 34,
        experimental_backgroundImage: `linear-gradient(to bottom, ${alpha(theme.colors.canvas, 0)} 0px, ${theme.colors.canvas} 10px)`,
      }}
    />
  );
}

/**
 * Claude's composer over the tabs: the agent a new chat goes to (tap to choose another), the
 * words to ask it, and New chat (touch and hold for chats you started writing).
 */
function AskBar() {
  const theme = useTheme();
  const ask = useAsk();
  const state = useAgentProviders().data;
  const agent = state?.providers.find((p) => p.id === state.selected);
  const words = agent ? `Ask ${agent.name}` : "New chat";
  return (
    <Glass interactive style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 5 }}>
      <Pressable
        onPress={() => showCard({ kind: "agents" })}
        accessibilityRole="button"
        accessibilityLabel={`Agent, ${agent?.name ?? "none"}`}
        accessibilityHint="Chooses the agent new chats go to"
        style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center" }}
      >
        {agent ? (
          <AgentAvatar agent={agent.id} size={28} />
        ) : (
          <Icon name="person.crop.circle" size={22} color="mutedForeground" />
        )}
      </Pressable>
      <Pressable
        onPress={ask}
        accessibilityRole="button"
        accessibilityLabel={words}
        testID="New chat"
        style={{ flex: 1, minHeight: 38, justifyContent: "center", paddingLeft: 6 }}
      >
        <Text size="base" color="mutedForeground" numberOfLines={1}>
          {words}
        </Text>
      </Pressable>
      <Pressable
        onPress={ask}
        onLongPress={() => {
          haptics.impact();
          showCard({ kind: "drafts" });
        }}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel="Write a new chat"
        accessibilityActions={[{ name: "activate" }, { name: "drafts", label: "Drafts" }]}
        onAccessibilityAction={(event) =>
          event.nativeEvent.actionName === "drafts" ? showCard({ kind: "drafts" }) : ask()
        }
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: theme.colors.foreground,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="square.and.pencil" size={16} weight="semibold" color="canvas" />
      </Pressable>
    </Glass>
  );
}

const TAB_WIDTH = 58;
const TAB_HEIGHT = 36;
const ROW_INSET = 48;
const SPRING = { duration: 280, dampingRatio: 0.8 };

/**
 * Where the pill is, shared by every tab's row: each tab draws its own bars, so the pill a tap
 * set going keeps sliding in the tab it opens, as all of SwiftUI's rows follow one `place`.
 */
const pill = makeMutable(0);
const slidePill = (to: number) => pill.set(withSpring(to, SPRING));

/** What the tabs show: how many chats are unread or wait on you, and "!" while a task fails. */
function useBadges(): Partial<Record<Tab, string>> {
  const unread = useChats((s) => unreadChats(s).size);
  const failing = scheduledSummary(useScheduledTasks().data ?? []).failing;
  return { chats: unread > 0 ? String(unread) : undefined, scheduled: failing ? "!" : undefined };
}

/**
 * The tabs. Slide a finger across them to switch, with a tick at each; touch and hold one for
 * what was in it lately.
 */
function TabRow({ tab }: { tab: Tab }) {
  const theme = useTheme();
  const badges = useBadges();
  const current = TABS.findIndex((t) => t.id === tab);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const hovering = useRef<number | null>(null);
  const scrubbing = useRef(false);
  const lit = hovered ?? current;
  const cell = width / TABS.length;

  useFocusEffect(useCallback(() => slidePill(current), [current]));

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pill.get() * cell + (cell - TAB_WIDTH) / 2 }],
  }));

  const at = (x: number) => Math.max(0, Math.min(TABS.length - 1, Math.floor(x / cell)));
  const hover = (index: number | null) => {
    hovering.current = index;
    setHovered(index);
    if (index !== null) slidePill(index);
  };
  const open = (index: number) => {
    hover(null);
    slidePill(index);
    router.navigate(TABS[index].href);
  };

  // Three gestures race: a tap opens the tab, a hold its recents, a slide scrubs across the row.
  const tap = useTapGesture({
    runOnJS: true,
    onBegin: (event) => hover(at(event.x)),
    onActivate: (event) => open(at(event.x)),
    onFinalize: (event) => {
      if (event.canceled && hovering.current !== null && !scrubbing.current) {
        hover(null);
        slidePill(current);
      }
    },
  });
  const hold = useLongPressGesture({
    runOnJS: true,
    minDuration: 400,
    onActivate: (event) => {
      hover(null);
      slidePill(current);
      haptics.impact();
      showCard({ kind: "recents", tab: TABS[at(event.x)].id });
    },
  });
  const scrub = usePanGesture({
    runOnJS: true,
    activeOffsetX: [-10, 10],
    onActivate: () => {
      scrubbing.current = true;
    },
    onUpdate: (event) => {
      const over = at(event.x);
      if (hovering.current === over) return;
      haptics.tap();
      hover(over);
    },
    onDeactivate: (event) => open(at(event.x)),
    onFinalize: () => {
      scrubbing.current = false;
    },
  });
  const gesture = useCompetingGestures(scrub, hold, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{
          height: TABS_HEIGHT,
          marginHorizontal: ROW_INSET,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              width: TAB_WIDTH,
              height: TAB_HEIGHT,
              borderRadius: TAB_HEIGHT / 2,
              backgroundColor: alpha(theme.colors.foreground, 0.07),
              opacity: width ? 1 : 0,
            },
            pillStyle,
          ]}
        />
        {TABS.map((t, index) => {
          const badge = badges[t.id];
          return (
            <View
              key={t.id}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t.name}
              accessibilityValue={badge ? { text: badge } : undefined}
              accessibilityState={{ selected: index === current }}
              accessibilityActions={[{ name: "activate" }, { name: "recent", label: "Recent" }]}
              onAccessibilityAction={(event) =>
                event.nativeEvent.actionName === "recent"
                  ? showCard({ kind: "recents", tab: t.id })
                  : router.navigate(t.href)
              }
              style={{ flex: 1, alignItems: "center" }}
            >
              <View
                style={{
                  width: TAB_WIDTH,
                  height: TAB_HEIGHT,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  name={t.icon}
                  size={18}
                  weight="medium"
                  color={index === lit ? "foreground" : "mutedForeground"}
                />
                {badge ? (
                  <View style={{ position: "absolute", top: -2, right: 6 }}>
                    <Badge variant={t.id === "scheduled" ? "destructive" : "primary"}>
                      {badge}
                    </Badge>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </GestureDetector>
  );
}
