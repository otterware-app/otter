import { isProviderUsable, useAgentProviders } from "@otter/client/agents/agent-providers";
import { agentApi, type ChatSession } from "@otter/client/agents/api";
import { shortAgo, useNow } from "@otter/client/agents/chat-shelves";
import { openServerSession, useChats } from "@otter/client/agents/chat-store";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, SectionList, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { openChat } from "../frame/navigation.ts";
import { SearchField } from "./search-field.tsx";

/** "On your agents" (ChatsScreen.swift's SessionsSheet): sessions the agents keep that aren't chats here. */
export function SessionsSheet() {
  const theme = useTheme();
  const providers = useAgentProviders().data?.providers ?? [];
  const usable = providers.filter(isProviderUsable);
  const conversations = useChats((s) => s.conversations);
  const now = useNow(60_000);
  const [query, setQuery] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const sessions = useQuery({
    queryKey: ["agent-sessions", usable.map((p) => p.id), everywhere],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          usable.map(async (p) => [
            p.id,
            await agentApi.sessions(p.id, 40, everywhere).catch(() => [] as ChatSession[]),
          ]),
        ),
      ) as Record<string, ChatSession[]>,
  });
  const needle = query.trim().toLowerCase();
  const sections = usable.flatMap((agent) => {
    const known = new Set(
      conversations.filter((c) => c.provider === agent.id).map((c) => c.sessionId),
    );
    const data = (sessions.data?.[agent.id] ?? []).filter(
      (s) =>
        !known.has(s.id) &&
        (!needle || (s.title ?? s.preview ?? "").toLowerCase().includes(needle)),
    );
    return data.length > 0 ? [{ agent, data }] : [];
  });
  const open = (session: ChatSession, agent: (typeof usable)[number]) => {
    openServerSession(session, agent.id, agent.name);
    openChat(useChats.getState().activeId);
  };

  return (
    <Sheet
      title="On your agents"
      onCancel={() => router.back()}
      cancelLabel="Close"
      trailing={
        usable.some((p) => p.otherSessions) ? (
          <Button
            title="Show all"
            size="lg"
            variant={everywhere ? "glass-prominent" : "glass"}
            tint={everywhere ? theme.colors.primary : undefined}
            onPress={() => setEverywhere(!everywhere)}
          />
        ) : null
      }
      scrolls={false}
    >
      <SectionList
        sections={sections}
        keyExtractor={(session) => session.id}
        keyboardDismissMode="interactive"
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        style={{ marginHorizontal: -18 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 18 }}>
            <SearchField prompt="Search sessions" text={query} onChange={setQuery} />
          </View>
        }
        ListEmptyComponent={
          sessions.isPending ? (
            <View style={{ paddingTop: 80 }}>
              <Spinner />
            </View>
          ) : (
            <EmptyState
              icon="bubble.left.and.bubble.right"
              title="No other sessions"
              description="Chats your agents keep that aren't here yet show up in this list."
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 18,
              paddingTop: 14,
              paddingBottom: 4,
            }}
            accessibilityRole="header"
          >
            <AgentAvatar agent={section.agent.id} size={15} />
            <Text size="sm" weight="medium" color="mutedForeground">
              On {section.agent.name}
            </Text>
          </View>
        )}
        renderItem={({ item, section }) => (
          <Pressable
            onPress={() => open(item, section.agent)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: 18,
              paddingVertical: 10,
              gap: 3,
              backgroundColor: pressed ? alpha(theme.colors.foreground, 0.06) : undefined,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text size="base" weight="medium" numberOfLines={1} style={{ flex: 1 }}>
                {item.title ?? item.preview ?? "Untitled chat"}
              </Text>
              <Text size="body" color="faintForeground" tabular>
                {shortAgo(item.lastActive, now)}
              </Text>
            </View>
            {item.preview && item.title ? (
              <Text size="body" color="mutedForeground" numberOfLines={1}>
                {item.preview}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </Sheet>
  );
}
