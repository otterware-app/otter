import { isBlank, useChats } from "@otter/client/agents/chat-store";
import { startup } from "@otter/mobile/start";
import { ListRow } from "@otter/ui-native/components/list-row";
import { Separator } from "@otter/ui-native/components/separator";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { FlashList } from "@shopify/flash-list";
import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useHideBars } from "../frame/frame-store.ts";
import { openChat } from "../frame/navigation.ts";
import { useBottomBarInset } from "../frame/tab-root.tsx";

/** Chats (ChatsScreen.swift): the shelves, a row a chat, swipes, search. A plain list for now. */
export function ChatsScreen() {
  const ready = useChats((s) => s.ready);
  const conversations = useChats((s) => s.conversations);
  const chats = conversations.filter((c) => !isBlank(c));
  const inset = useBottomBarInset();
  const [selecting, setSelecting] = useState(false);
  useHideBars(selecting);

  useEffect(() => {
    if (ready && chats.length > 0 && !startup.listShownAt) startup.listShownAt = Date.now();
  }, [ready, chats.length]);

  return (
    <>
      <Stack.Screen options={{ title: selecting ? "Select chats" : "" }} />
      {selecting ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="checkmark"
            variant="prominent"
            onPress={() => setSelecting(false)}
          >
            Done
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.View hidesSharedBackground>
              <View style={{ flexDirection: "row", gap: 5 }} accessible accessibilityRole="header">
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
            <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search chats" />
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
              <Stack.Toolbar.MenuAction icon="checkmark.circle" onPress={() => setSelecting(true)}>
                Select chats
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="bubble.left.and.bubble.right"
                onPress={() => router.push("/sessions")}
              >
                On your agents
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      )}
      <FlashList
        data={ready ? chats : []}
        keyExtractor={(chat) => chat.id}
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: inset }}
        scrollIndicatorInsets={{ bottom: inset }}
        ItemSeparatorComponent={() => <Separator inset={16} />}
        ListEmptyComponent={ready ? <ListRow title="No chats" /> : <Spinner />}
        renderItem={({ item }) => (
          <ListRow
            title={item.title || "New chat"}
            subtitle={new Date(item.updatedAt).toLocaleString()}
            trailing={<AgentAvatar agent={item.provider} size={16} />}
            onPress={() => (selecting ? undefined : openChat(item.id))}
          />
        )}
      />
    </>
  );
}
