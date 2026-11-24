import { runClock } from "@otter/client/agents/chat-list";
import { useChats } from "@otter/client/agents/chat-store";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { router } from "expo-router";
import { memo, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { useHasBrowser } from "./browser-source.ts";

/** The time, a second at a time while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** The run's clock, the agent's browser and what's queued, floating over the composer. */
export const WorkingControl = memo(function WorkingControl({ chatId }: { chatId: string }) {
  const theme = useTheme();
  const running = useChats((s) => Boolean(s.runs[chatId]));
  const now = useNow(running);
  const clock = useChats((s) => {
    const chat = s.conversations.find((c) => c.id === chatId);
    return chat ? runClock(s, chat, now) : null;
  });
  const queued = useChats((s) => s.queue.filter((m) => m.convoId === chatId).length);
  const browser = useHasBrowser(chatId);
  if (!clock && !browser && queued === 0) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      layout={LinearTransition.duration(200)}
      style={{ alignSelf: "center", marginBottom: 4 }}
    >
      <Glass style={{ height: 38, flexDirection: "row", alignItems: "center" }}>
        {clock ? (
          <Text size="body" weight="medium" tabular style={{ paddingHorizontal: 14 }}>
            {clock}
          </Text>
        ) : null}
        {clock && (browser || queued > 0) ? (
          <View style={{ width: 1, height: 16, backgroundColor: theme.colors.border }} />
        ) : null}
        {browser ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View browser"
            accessibilityHint="Watch and control the browser tab open in this chat"
            onPress={() =>
              router.push({ pathname: "/agents/[id]/browser", params: { id: chatId } })
            }
            style={{
              height: 38,
              minWidth: 44,
              paddingHorizontal: !clock && queued === 0 ? 16 : 0,
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Icon name="globe" size={20} />
            {!clock && queued === 0 ? (
              <Text size="body" weight="medium">
                One tab open
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {(clock || browser) && queued > 0 ? (
          <View style={{ width: 1, height: 16, backgroundColor: theme.colors.border }} />
        ) : null}
        {queued > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${queued} queued`}
            onPress={() => router.push({ pathname: "/agents/[id]/queue", params: { id: chatId } })}
            style={{
              height: 38,
              paddingHorizontal: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="list.number" size={13} />
            <Text size="body" weight="medium">
              {queued} queued
            </Text>
          </Pressable>
        ) : null}
      </Glass>
    </Animated.View>
  );
});
