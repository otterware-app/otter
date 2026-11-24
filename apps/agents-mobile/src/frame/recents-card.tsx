import { isProviderUsable, useAgentProviders } from "@otter/client/agents/agent-providers";
import { canCreateTasks, keyOf, useScheduledTasks } from "@otter/client/agents/agent-scheduled";
import { chatsWaitingOnYou, draftPreview } from "@otter/client/agents/chat-list";
import { hasDraft, isBlank, useChats } from "@otter/client/agents/chat-store";
import { useUpdateAgents } from "@otter/client/agents/agent-settings";
import { BadgeDot } from "@otter/ui-native/components/badge";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import type { Card } from "./frame-store.ts";
import { openChat, useAsk } from "./navigation.ts";
import { TABS } from "./tabs.ts";

type Status = "working" | "unread" | "failed" | "chosen" | null;

/** A row of a card: a chat, a task or an agent. */
type Item = { id: string; title: string; agent?: string; status?: Status; open: () => void };

type Contents = { items: Item[]; new?: { title: string; icon: IconName; open: () => void } };

/** What a card lists (RootView.swift's `cardView`): the newest of a tab, your agents, or drafts. */
function useContents(card: Card): Contents {
  const chats = useChats((s) => s.conversations);
  const drafts = useChats((s) => s.drafts);
  const runs = useChats((s) => s.runs);
  const unseen = useChats((s) => s.unseen);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const waiting = chatsWaitingOnYou({ runs, approvals, questions });
  const providers = useAgentProviders().data;
  const scheduled = useScheduledTasks().data;
  const updateAgents = useUpdateAgents();
  const ask = useAsk();
  const usable = providers?.providers.filter(isProviderUsable) ?? [];
  const newest = <T extends { updatedAt: number }>(list: T[]) =>
    list.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  switch (card.kind) {
    case "agents":
      return {
        items: usable.map((p) => ({
          id: p.id,
          title: p.name,
          agent: p.id,
          status: p.id === providers?.selected ? "chosen" : null,
          open: () => {
            haptics.tap();
            updateAgents({ selected: p.id });
          },
        })),
        new: { title: "Your agents", icon: "gearshape", open: () => router.navigate("/settings") },
      };
    case "drafts":
      return {
        items: newest(chats.filter((c) => hasDraft(drafts, c.id))).map((c) => ({
          id: c.id,
          title: isBlank(c) ? draftPreview(drafts[c.id] ?? "") || "New chat" : c.title,
          agent: c.provider,
          open: () => openChat(c.id),
        })),
        new: { title: "New chat", icon: "plus.circle.fill", open: ask },
      };
  }
  switch (card.tab) {
    case "chats":
      return {
        items: newest(chats.filter((c) => !isBlank(c))).map((c) => ({
          id: c.id,
          title: c.title || "New chat",
          agent: c.provider,
          status: runs[c.id] ? "working" : unseen.has(c.id) || waiting.has(c.id) ? "unread" : null,
          open: () => openChat(c.id),
        })),
        new: { title: "New chat", icon: "plus.circle.fill", open: ask },
      };
    case "scheduled": {
      const tasks = (scheduled ?? [])
        .flatMap((agent) => agent.tasks)
        .sort((a, b) => (b.lastRun?.at ?? 0) - (a.lastRun?.at ?? 0))
        .slice(0, 5);
      return {
        items: tasks.map((task) => ({
          id: keyOf(task),
          title: task.name,
          agent: task.provider,
          status: task.running ? "working" : task.lastRun?.status === "error" ? "failed" : null,
          open: () => router.navigate({ pathname: "/scheduled/[id]", params: { id: keyOf(task) } }),
        })),
        new: canCreateTasks(scheduled ?? [])
          ? {
              title: "New task",
              icon: "plus.circle.fill",
              open: () => router.navigate("/scheduled/new"),
            }
          : undefined,
      };
    }
    case "settings":
      return {
        items: usable.slice(0, 5).map((p) => ({
          id: p.id,
          title: p.name,
          agent: p.id,
          open: () => router.navigate({ pathname: "/settings/agents/[id]", params: { id: p.id } }),
        })),
      };
  }
}

function StatusMark({ status }: { status: Status | undefined }) {
  switch (status) {
    case "working":
      return <Spinner size="mini" />;
    case "unread":
      return <BadgeDot />;
    case "failed":
      return <Icon name="exclamationmark.circle.fill" size={12} color="error" />;
    case "chosen":
      return <Icon name="checkmark" size={12} weight="semibold" color="primary" />;
    default:
      return null;
  }
}

function Row({
  title,
  icon,
  status,
  onPress,
}: {
  title: string;
  icon: ReactNode;
  status?: Status;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: status === "chosen" }}
      style={({ pressed }) => ({
        height: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <View style={{ width: 18, alignItems: "center" }}>{icon}</View>
      <Text size="sm" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
      <StatusMark status={status} />
    </Pressable>
  );
}

/**
 * Claude's tabs (BottomBar.swift's `TabRecentsCard`): what was in a tab lately, and a new one of
 * it at the bottom; the same card lists your agents and your drafts.
 */
export function RecentsCard({ card, close }: { card: Card; close: () => void }) {
  const { items, new: fresh } = useContents(card);
  const pick = (open: () => void) => {
    close();
    open();
  };
  return (
    <Glass shape={{ radius: 22 }} style={{ width: 236, padding: 5 }}>
      {items.map((item) => (
        <Row
          key={item.id}
          title={item.title}
          status={item.status}
          icon={<AgentAvatar agent={item.agent} size={16} />}
          onPress={() => pick(item.open)}
        />
      ))}
      {fresh ? (
        <Row
          title={fresh.title}
          icon={<Icon name={fresh.icon} size={15} />}
          onPress={() => pick(fresh.open)}
        />
      ) : null}
    </Glass>
  );
}

/** Where a card stands over the bar: under the tab held, or at the ask bar's ends. */
export const cardAlignment = (card: Card) =>
  card.kind === "agents" || (card.kind === "recents" && card.tab === TABS[0].id)
    ? "flex-start"
    : card.kind === "recents" && card.tab === "scheduled"
      ? "center"
      : "flex-end";
