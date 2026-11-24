import { splitAnswer } from "@otter/client/agents/chat-runs";
import { loadChat, useChats } from "@otter/client/agents/chat-store";
import { Markdown } from "@otter/ui-native/components/markdown";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useEffect } from "react";
import { View } from "react-native";

/** What touch and hold shows over the list: the chat's last messages, as WhatsApp's preview does (ChatPreview.swift). */
export function ChatPreview({ id }: { id: string }) {
  const theme = useTheme();
  const chat = useChats((s) => s.conversations.find((c) => c.id === id));
  const loaded = chat?.loaded ?? true;
  useEffect(() => {
    if (!loaded) void loadChat(id);
  }, [id, loaded]);
  if (!chat) return null;
  const turns = chat.turns.slice(-4).flatMap((turn) => {
    const text = (
      turn.role === "user" ? turn.text : splitAnswer(turn.items ?? []).answer || turn.text
    ).trim();
    return text ? [{ id: turn.id, mine: turn.role === "user", text }] : [];
  });
  const outgoing = alpha(theme.colors.primary, theme.scheme === "dark" ? 0.38 : 0.16);
  return (
    <View style={{ width: 320, height: 380, backgroundColor: theme.colors.canvas }}>
      <View style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }}>
        <Text size="md" weight="semibold" numberOfLines={1} style={{ textAlign: "center" }}>
          {chat.title}
        </Text>
      </View>
      <View
        style={{ flex: 1, padding: 12, gap: 6, justifyContent: "flex-end", overflow: "hidden" }}
      >
        {turns.map((turn) => (
          <View
            key={turn.id}
            style={{
              alignSelf: turn.mine ? "flex-end" : "flex-start",
              marginLeft: turn.mine ? 36 : 0,
              marginRight: turn.mine ? 0 : 36,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 18,
              borderCurve: "continuous",
              backgroundColor: turn.mine ? outgoing : theme.colors.card,
            }}
          >
            <Markdown markdown={turn.text} numberOfLines={6} selectable={false} />
          </View>
        ))}
        {!chat.loaded || turns.length === 0 ? (
          <Text size="body" color="mutedForeground" style={{ textAlign: "center" }}>
            Open the chat to read it
          </Text>
        ) : null}
      </View>
    </View>
  );
}
