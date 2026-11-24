import { Button as MenuButton, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import { queuedText } from "@otter/client/agents/chat-queue";
import {
  editQueued,
  removeQueued,
  steerQueued,
  useChats,
  type QueuedMessage,
} from "@otter/client/agents/chat-store";
import { canSteer } from "@otter/client/agents/composer";
import { Icon } from "@otter/ui-native/components/icon";
import { Separator } from "@otter/ui-native/components/separator";
import { Sheet } from "@otter/ui-native/components/sheet";
import { SwipeRow } from "@otter/ui-native/components/swipe-row";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { useTheme } from "@otter/ui-native/theme";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import { useChatAgent } from "./chat-agent.ts";

/** The chat's queued messages (AskCards.swift's `QueueSheet`): each in full, with Send now, and Edit and Remove behind a swipe or a long press. */
export function QueueSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queued = useChats(useShallow((s) => s.queue.filter((m) => m.convoId === id)));
  const editingId = useChats((s) => s.editingQueued?.id ?? null);
  const traits = useChatAgent(id).traits;
  const canSendNow = useChats((s) => canSteer(s, id)) && Boolean(traits);
  const empty = queued.length === 0;

  useEffect(() => {
    if (empty) router.back();
  }, [empty]);

  return (
    <Sheet title="Queued" onCancel={() => router.back()}>
      <View style={{ marginHorizontal: -18 }}>
        {queued.map((message, index) => (
          <View key={message.id}>
            {index > 0 ? <Separator inset={16} /> : null}
            <Row
              message={message}
              editing={editingId === message.id}
              canSendNow={canSendNow && !message.attachments}
            />
          </View>
        ))}
      </View>
    </Sheet>
  );
}

function Row({
  message,
  editing,
  canSendNow,
}: {
  message: QueuedMessage;
  editing: boolean;
  canSendNow: boolean;
}) {
  const theme = useTheme();
  const edit = () => {
    editQueued(message.id);
    router.back();
  };
  const sendNow = () => {
    haptics.tap();
    steerQueued(message.id);
  };
  const remove = () => removeQueued(message.id);
  const words = queuedText(message);
  return (
    <SwipeRow
      square
      trailing={[
        { title: "Remove", icon: "trash", tint: theme.colors.destructive, onPerform: remove },
        { title: "Edit", icon: "pencil", tint: theme.colors.primary, onPerform: edit },
      ]}
    >
      <View
        style={{
          minHeight: 44,
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: theme.colors.canvas,
        }}
      >
        <Host style={{ flex: 1 }} matchContents={{ vertical: true }} colorScheme={theme.scheme}>
          <ContextMenu>
            <ContextMenu.Trigger>
              <RNHostView matchContents={{ vertical: true }}>
                <View
                  accessible
                  accessibilityActions={[
                    { name: "edit", label: "Edit in the composer" },
                    { name: "remove", label: "Remove from queue" },
                  ]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "edit") edit();
                    if (event.nativeEvent.actionName === "remove") remove();
                  }}
                  style={{ gap: 4 }}
                >
                  <Text
                    size="sm"
                    color={editing ? "mutedForeground" : "foreground"}
                    numberOfLines={4}
                  >
                    {words}
                  </Text>
                  {editing ? (
                    <Text size="xs" color="mutedForeground">
                      Editing in the composer
                    </Text>
                  ) : message.sent?.length ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="paperclip" size={11} color="mutedForeground" />
                      <Text size="xs" color="mutedForeground" numberOfLines={1} style={{ flex: 1 }}>
                        {message.sent.map((a) => a.name).join(", ")}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </RNHostView>
            </ContextMenu.Trigger>
            <ContextMenu.Items>
              {canSendNow ? (
                <MenuButton label="Send now" systemImage="arrow.up" onPress={sendNow} />
              ) : null}
              <MenuButton label="Edit in the composer" systemImage="pencil" onPress={edit} />
              <MenuButton
                label="Remove from queue"
                systemImage="trash"
                role="destructive"
                onPress={remove}
              />
            </ContextMenu.Items>
          </ContextMenu>
        </Host>
        {canSendNow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send now"
            accessibilityHint="Send into the current turn"
            onPress={sendNow}
            style={{
              height: 32,
              paddingHorizontal: 12,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.colors.primary,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="arrow.up" size={13} weight="semibold" color="primaryForeground" />
            <Text size="body" weight="semibold" color="primaryForeground">
              Send now
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SwipeRow>
  );
}
