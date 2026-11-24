import { useChats } from "@otter/client/agents/chat-store";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

/** A chat: the transcript and the composer (ChatScreen.swift). Pushed over the list, the bars gone. */
export function ChatScreen() {
  const { id } = useLocalSearchParams<"/chats/[id]">();
  const title = useChats((s) => s.conversations.find((c) => c.id === id)?.title) || "New chat";
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title }} />
      <EmptyState
        icon="bubble.left.and.bubble.right"
        title={title}
        description="The transcript and the composer go here."
      />
      <View style={{ alignItems: "center", gap: 10 }}>
        {(["details", "model", "queue", "browser", "talk"] as const).map((place) => (
          <Button
            key={place}
            title={place[0].toUpperCase() + place.slice(1)}
            variant="secondary"
            onPress={() => router.push({ pathname: `/chats/[id]/${place}`, params: { id } })}
          />
        ))}
        <Button
          title="A file"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: "/chats/[id]/file", params: { id, path: "notes/plan.md" } })
          }
        />
      </View>
    </ScrollView>
  );
}
