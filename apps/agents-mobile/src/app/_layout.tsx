import { useChatEvents } from "@otter/client/agents/chat-store";
import { startSyncedPreferences } from "@otter/client/preferences";
import { useNotices } from "@otter/mobile/notices";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Suspense, use, useEffect, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { coreStarted } from "../core";

export { ErrorBoundary } from "expo-router";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <Suspense fallback={<ActivityIndicator style={styles.starting} />}>
      <Started>
        <QueryClientProvider client={queryClient}>
          <FollowCore />
          <Stack>
            <Stack.Screen name="index" options={{ title: "Chats" }} />
            <Stack.Screen name="self-test" options={{ title: "Self-test" }} />
          </Stack>
          <Notices />
        </QueryClientProvider>
      </Started>
    </Suspense>
  );
}

function Started({ children }: { children: ReactNode }) {
  use(coreStarted);
  return children;
}

function FollowCore() {
  useChatEvents();
  useEffect(() => startSyncedPreferences(), []);
  return null;
}

function Notices() {
  const notices = useNotices();
  if (notices.length === 0) return null;
  return (
    <View style={styles.notices} pointerEvents="box-none">
      {notices.map((notice) => (
        <Pressable key={notice.id} style={styles.notice} onPress={notice.close}>
          <Text style={styles.noticeTitle}>{notice.title}</Text>
          {notice.body ? <Text>{notice.body}</Text> : null}
          {notice.action ? (
            <Text
              style={styles.noticeAction}
              onPress={() => {
                notice.action?.run();
                notice.close();
              }}
            >
              {notice.action.label}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  starting: { flex: 1 },
  notices: { position: "absolute", left: 16, right: 16, bottom: 48, gap: 8 },
  notice: { padding: 12, borderRadius: 12, backgroundColor: "#eee", gap: 4 },
  noticeTitle: { fontWeight: "600" },
  noticeAction: { color: "#007aff" },
});
