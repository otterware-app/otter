import type { ChatSession } from "@otter-mail/contracts/chats";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActionSheetIOS,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { agents, chats, useChats, type AgentProvider } from "../../state/chats";
import { core } from "../../state/core";
import { agentName } from "../settings/AgentSettings";
import { relativeDate, type Palette } from "../theme";
import { matchesQuery } from "./chat-logic";

const nameOf = (kind: string) => {
  const p = agents.get().providers.find((a) => a.kind === kind);
  return p ? agentName(p) : kind;
};

/**
 * apps/ios's ChatHistory, swiped in from the left: the account's chats, and
 * the agent's own sessions no chat holds yet.
 */
export function ChatList({
  provider,
  colors,
  visible,
  onClose,
}: {
  provider: AgentProvider | undefined;
  colors: Palette;
  visible: boolean;
  onClose: () => void;
}) {
  const conversations = useChats((s) => s.conversations);
  const activeId = useChats((s) => s.activeId);
  const unseen = useChats((s) => s.unseen);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const kind = provider?.kind;
  const listsSessions = Boolean(provider?.sessions && provider.status === "ready");

  useEffect(() => {
    if (!visible || !kind || !listsSessions) return;
    void core
      .invoke<ChatSession[]>("agent:sessions", { provider: kind, limit: 40 })
      .then(setSessions, () => setSessions([]));
  }, [visible, kind, listsSessions]);

  const synced = conversations.filter(
    (c) => (c.turns.length > 0 || !c.loaded) && matchesQuery(c.title, query),
  );
  const linked = new Set(conversations.filter((c) => c.provider === kind).map((c) => c.sessionId));
  const others = sessions.filter(
    (s) => !linked.has(s.id) && (matchesQuery(s.title, query) || matchesQuery(s.preview, query)),
  );

  const remove = (title: string, run: () => void) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: ["Delete", "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => i === 0 && run(),
    );

  return (
    <View style={styles.fill} testID="chat-history">
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Chats</Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityLabel="Close"
          testID="chat-history-close"
        >
          <SymbolView name="xmark" size={17} tintColor={colors.secondary} />
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: colors.card }]}>
        <SymbolView name="magnifyingglass" size={15} tintColor={colors.secondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search chats"
          placeholderTextColor={colors.secondary}
          style={[styles.searchInput, { color: colors.text }]}
          clearButtonMode="while-editing"
          testID="chat-history-search"
        />
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardDismissMode="on-drag">
        {synced.length === 0 && others.length === 0 ? (
          <Text style={[styles.empty, { color: colors.secondary }]}>No chats</Text>
        ) : null}
        {synced.map((c) => (
          <Row
            key={c.id}
            colors={colors}
            title={c.title}
            detail={c.device ? `${nameOf(c.provider)} on ${c.device.name}` : nameOf(c.provider)}
            time={c.updatedAt}
            active={c.id === activeId}
            unseen={unseen.has(c.id)}
            onPress={() => {
              chats.showChat(c.id);
              onClose();
            }}
            onLongPress={() => remove(c.title, () => chats.deleteConversation(c.id, c.provider))}
          />
        ))}
        {others.length > 0 && provider ? (
          <>
            <Text style={[styles.section, { color: colors.secondary }]}>
              {`On ${agentName(provider)}`.toUpperCase()}
            </Text>
            {others.map((s) => (
              <Row
                key={s.id}
                colors={colors}
                title={s.title ?? s.preview ?? "Untitled chat"}
                detail={s.title ? (s.preview ?? undefined) : undefined}
                time={s.lastActive}
                onPress={() => {
                  chats.openServerSession(s, provider.kind, agentName(provider));
                  onClose();
                }}
                onLongPress={() =>
                  remove(s.title ?? "Untitled chat", () => {
                    setSessions((all) => all.filter((x) => x.id !== s.id));
                    void core
                      .invoke("agent:deleteSession", { provider: provider.kind, sessionId: s.id })
                      .catch(() => {});
                  })
                }
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({
  colors,
  title,
  detail,
  time,
  active,
  unseen,
  onPress,
  onLongPress,
}: {
  colors: Palette;
  title: string;
  detail?: string;
  time: number;
  active?: boolean;
  unseen?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        (pressed || active) && { backgroundColor: pressed ? colors.pressed : colors.selected },
      ]}
    >
      <View style={styles.rowTop}>
        {unseen ? <View style={[styles.dot, { backgroundColor: colors.focus }]} /> : null}
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.time, { color: colors.secondary }]}>{relativeDate(time)}</Text>
      </View>
      {detail ? (
        <Text style={[styles.detail, { color: colors.secondary }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingTop: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  title: { fontSize: 22, fontWeight: "700" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    height: 38,
  },
  searchInput: { flex: 1, fontSize: 16 },
  list: { paddingHorizontal: 8, paddingBottom: 24 },
  empty: { textAlign: "center", marginTop: 40, fontSize: 15 },
  section: { fontSize: 12, fontWeight: "600", marginTop: 16, marginBottom: 4, marginLeft: 12 },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowTitle: { flex: 1, fontSize: 16 },
  time: { fontSize: 14 },
  detail: { fontSize: 14 },
});
