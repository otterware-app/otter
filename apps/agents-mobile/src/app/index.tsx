import { isBlank, useChats } from "@otter/client/agents/chat-store";
import { startup } from "@otter/mobile/start";
import { Link } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";

import { DEV_TOOLS } from "../core";

export default function Chats() {
  const ready = useChats((s) => s.ready);
  const conversations = useChats((s) => s.conversations);
  const chats = conversations.filter((c) => !isBlank(c));

  useEffect(() => {
    if (ready && chats.length > 0 && !startup.listShownAt) startup.listShownAt = Date.now();
  }, [ready, chats.length]);

  return (
    <FlatList
      data={ready ? chats : []}
      keyExtractor={(chat) => chat.id}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={
        DEV_TOOLS ? (
          <View style={styles.dev}>
            <Link href="/self-test" style={styles.link}>
              Self-test
            </Link>
            {startup.coreReadyAt ? (
              <Text style={styles.detail}>
                Core ready {startup.coreReadyAt - startup.launchedAt} ms after launch
                {startup.listShownAt
                  ? `, chats listed at ${startup.listShownAt - startup.launchedAt} ms`
                  : ""}
              </Text>
            ) : null}
          </View>
        ) : undefined
      }
      ListEmptyComponent={ready ? <Text style={styles.row}>No chats</Text> : <ActivityIndicator />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.title}>{item.title || "New chat"}</Text>
          <Text style={styles.detail}>
            {item.provider} · {new Date(item.updatedAt).toLocaleString()}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  dev: { padding: 16, gap: 4 },
  link: { color: "#007aff", fontSize: 17 },
  row: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 17 },
  detail: { color: "#888" },
});
