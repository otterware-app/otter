import { isBlank, useChats } from "@otter/client/agents/chat-store";
import { Toast } from "@otter/ui-native/components/toast";
import { usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TABS_HEIGHT } from "./bottom-bar.tsx";
import { showCard, showFinished, useFrame } from "./frame-store.ts";
import { openChat } from "./navigation.ts";
import { cardAlignment, RecentsCard } from "./recents-card.tsx";

/**
 * The app's frame (RootView.swift): three tabs, each its own stack, without the system's tab
 * bar: each tab's first screen draws the bars (`TabRoot`). Over them, the card a tab or the ask
 * bar opens, and a chat finishing elsewhere.
 */
export function TabsFrame() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, lazy: false }}>
        <Tabs.Screen name="(chats)" />
        <Tabs.Screen name="(scheduled)" />
        <Tabs.Screen name="(settings)" />
      </Tabs>
      <CardOverlay />
      <FinishedNotice />
    </View>
  );
}

const spring = { duration: 300, dampingRatio: 0.8 };

/** Grows from the bar, as `.transition(.scale(scale: 0.6, anchor: .bottom))`. */
function cardIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withSpring(1, spring), transform: [{ scale: withSpring(1, spring) }] },
  };
}

function CardOverlay() {
  const card = useFrame((s) => s.card);
  const insets = useSafeAreaInsets();
  if (!card) return null;
  const close = () => showCard(null);
  const overBar = card.kind === "agents" || card.kind === "drafts";
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(180)}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1, backgroundColor: "#00000014" }}
        />
      </Animated.View>
      <Animated.View
        entering={cardIn}
        exiting={FadeOut.duration(180)}
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          // A tab's over the ask bar, the tabs left in view under it; the bar's own over the bar.
          bottom: insets.bottom + TABS_HEIGHT + (overBar ? 60 : 4),
          alignItems: cardAlignment(card),
          transformOrigin: "bottom",
        }}
      >
        <RecentsCard card={card} close={close} />
      </Animated.View>
    </View>
  );
}

/** A chat that finished while you were elsewhere, as Claude's "Completed": tap to open it. */
function FinishedNotice() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const finished = useFrame((s) => s.finished);
  const runs = useChats((s) => s.runs);
  const chat = useChats((s) => s.conversations.find((c) => c.id === finished));
  const before = useRef(runs);

  useEffect(() => {
    const done = Object.keys(before.current).find(
      (id) => !runs[id] && pathname !== `/agents/${id}`,
    );
    before.current = runs;
    if (!done) return;
    const found = useChats.getState().conversations.find((c) => c.id === done);
    if (found && !isBlank(found)) showFinished(done);
  }, [runs, pathname]);

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => showFinished(null), 4000);
    return () => clearTimeout(timer);
  }, [finished]);

  if (!chat || pathname === `/agents/${chat.id}`) return null;
  return (
    <Animated.View
      entering={FadeInDown.duration(250)}
      exiting={FadeOut.duration(200)}
      style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + TABS_HEIGHT + 76 }}
    >
      <Toast
        text={`${chat.title} · Done`}
        icon="checkmark.circle"
        onPress={() => {
          showFinished(null);
          openChat(chat.id);
        }}
      />
    </Animated.View>
  );
}
