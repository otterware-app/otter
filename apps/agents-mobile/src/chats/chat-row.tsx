import { useAgentProviders } from "@otter/client/agents/agent-providers";
import {
  activityPreview,
  agentNameOf,
  chatActivity,
  chatAgentOf,
  chatRowDetail,
  isDetached,
  lastMessage,
  type ChatActivity,
} from "@otter/client/agents/chat-list";
import { formatDuration } from "@otter/client/agents/chat-runs";
import { useNow, wakesIn } from "@otter/client/agents/chat-shelves";
import {
  hasDraft,
  isElsewhere,
  loadChat,
  STOPPED,
  useChats,
  type Conversation,
} from "@otter/client/agents/chat-store";
import { dayText } from "@otter/client/agents/chat-time";
import { splitSearchText, type SearchRange } from "@otter/shared/chat-search";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme, type ColorToken, type TypeStep } from "@otter/ui-native/theme";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";

/**
 * What a chat is doing, the most pressing first: what blocks the agent on you, then what went
 * wrong, then what runs, then what's new, then what's left (ChatRow.swift's `RowState`).
 */
type RowState =
  | { kind: "activity"; activity: ChatActivity; queued: number }
  | { kind: "failed"; error: string }
  | { kind: "lost" }
  | { kind: "draft"; draft: string }
  | { kind: "idle" };

function useRowState(chat: Conversation): RowState {
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const queue = useChats((s) => s.queue);
  const draft = useChats((s) => s.drafts[chat.id]);
  const activity = chatActivity({ runs, approvals, questions }, chat);
  if (activity)
    return {
      kind: "activity",
      activity,
      queued: queue.filter((m) => m.convoId === chat.id).length,
    };
  const error = chat.loaded ? chat.turns.at(-1)?.error : undefined;
  if (error && error !== STOPPED) return { kind: "failed", error };
  if (isDetached({ runs }, chat)) return { kind: "lost" };
  if (draft && hasDraft({ [chat.id]: draft }, chat.id)) return { kind: "draft", draft };
  return { kind: "idle" };
}

/** Words with where a search found them in semibold. */
export function Marked({
  text,
  ranges,
  size,
}: {
  text: string;
  ranges: readonly SearchRange[];
  size: TypeStep;
}) {
  if (ranges.length === 0) return text;
  return splitSearchText(text, ranges).map((part) =>
    part.highlighted ? (
      <Text key={part.start} size={size} weight="semibold" color="foreground">
        {part.text}
      </Text>
    ) : (
      part.text
    ),
  );
}

const NONE: readonly SearchRange[] = [];

/**
 * A chat as WhatsApp lists one, without the big picture (ChatsScreen.swift's `ChatRow`): the
 * title, and one quiet line under it; what needs you stands out by color. The agent's mark is
 * small, and only when there are several.
 */
export function ChatRow({
  chat,
  now,
  showAgent,
  titleRanges = NONE,
  excerpt,
}: {
  chat: Conversation;
  now: number;
  showAgent: boolean;
  titleRanges?: readonly SearchRange[];
  /** A search's match in a message, in place of the line under the title. */
  excerpt?: { text: string; ranges: readonly SearchRange[] };
}) {
  const theme = useTheme();
  const state = useRowState(chat);
  const unread = useChats((s) => s.unseen.has(chat.id));
  const device = useChats((s) => s.device);
  const agent = chatAgentOf(chat);
  useEffect(() => {
    if (!chat.loaded) void loadChat(chat.id);
  }, [chat.id, chat.loaded]);
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View
        style={{
          paddingVertical: 12,
          gap: 4,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: alpha(theme.colors.mutedForeground, 0.2),
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            size="lg"
            weight={unread ? "semibold" : "regular"}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            <Marked text={chat.title} ranges={titleRanges} size="lg" />
          </Text>
          <View style={{ flex: 1, minWidth: 0 }} />
          {showAgent ? <AgentAvatar agent={agent.id} gatewayAgent={agent.agent} size={14} /> : null}
          <Time chat={chat} state={state} now={now} unread={unread} />
        </View>
        <View style={{ justifyContent: "center" }}>
          <View style={{ paddingRight: 30 }}>
            {excerpt ? (
              <Text size="sm" color="mutedForeground" numberOfLines={1}>
                <Marked text={excerpt.text} ranges={excerpt.ranges} size="sm" />
              </Text>
            ) : (
              <Preview chat={chat} state={state} unread={unread} />
            )}
          </View>
          <View style={styles.badges}>
            {isElsewhere(chat, device) ? (
              <View accessible accessibilityLabel={`On ${chat.device?.name ?? "a Mac"}`}>
                <Icon name="laptopcomputer" size={11} color="faintForeground" />
              </View>
            ) : null}
            {chat.pinnedAt != null ? (
              <View accessible accessibilityLabel="Pinned">
                <Icon
                  name="pin.fill"
                  size={11}
                  color="faintForeground"
                  style={{ transform: [{ rotate: "45deg" }] }}
                />
              </View>
            ) : null}
            <StateBadge state={state} unread={unread} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** When, as WhatsApp's time: how long it's been at it while it runs, when it wakes while snoozed, else its last message. */
function Time({
  chat,
  state,
  now,
  unread,
}: {
  chat: Conversation;
  state: RowState;
  now: number;
  unread: boolean;
}) {
  const activity = state.kind === "activity" ? state.activity : null;
  if (activity?.kind === "working" && activity.since !== undefined)
    return <Ticking since={activity.since} />;
  const day = dayText(chat.updatedAt, now, null);
  if (activity?.kind === "approval" || activity?.kind === "input")
    return (
      <Text size="body" weight="medium" color="warning" tabular>
        {day}
      </Text>
    );
  if (state.kind === "failed")
    return (
      <Text size="body" color="error" tabular>
        {day}
      </Text>
    );
  if (chat.snoozedUntil != null && chat.snoozedUntil > now) {
    const left = wakesIn(chat.snoozedUntil, now);
    return (
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        accessible
        accessibilityLabel={`Wakes in ${left}`}
      >
        <Icon name="bell" size={12} color="mutedForeground" />
        <Text size="body" color="mutedForeground" tabular>
          {left}
        </Text>
      </View>
    );
  }
  return (
    <Text
      size="body"
      weight={unread ? "medium" : "regular"}
      color={unread ? "primary" : "mutedForeground"}
      tabular
    >
      {dayText(chat.settledAt ?? chat.updatedAt, now, null)}
    </Text>
  );
}

function Ticking({ since }: { since: number }) {
  const now = useNow(1000);
  return (
    <Text size="body" weight="medium" color="primary" tabular>
      {formatDuration(Math.max(0, now - since))}
    </Text>
  );
}

function Line({
  icon,
  color,
  children,
}: {
  icon?: IconName;
  color: ColorToken;
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {icon ? <Icon name={icon} size={13} color={color} /> : null}
      <Text size="sm" color={color} numberOfLines={1} style={{ flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}

function Preview({
  chat,
  state,
  unread,
}: {
  chat: Conversation;
  state: RowState;
  unread: boolean;
}) {
  const agents = useAgentProviders().data;
  switch (state.kind) {
    case "activity": {
      const { activity, queued } = state;
      if (activity.kind === "approval")
        return (
          <Line icon="exclamationmark.shield.fill" color="warning">
            {activityPreview(activity)}
          </Line>
        );
      if (activity.kind === "input")
        return (
          <Line icon="questionmark.bubble.fill" color="questionForeground">
            {activityPreview(activity)}
          </Line>
        );
      const text = activityPreview(activity);
      const cut = queued > 0 ? text.lastIndexOf(" · ") : text.length;
      return (
        <Line color="primary">
          {text.slice(0, cut)}
          {queued > 0 ? (
            <Text size="sm" color="mutedForeground">
              {text.slice(cut)}
            </Text>
          ) : null}
        </Line>
      );
    }
    case "failed":
      return (
        <Line icon="exclamationmark.circle.fill" color="error">
          {state.error}
        </Line>
      );
    case "lost":
      return (
        <Line icon="bolt.horizontal" color="mutedForeground">
          Lost {agentNameOf(agents, chat.provider, null)} mid-reply
        </Line>
      );
    case "draft":
      return (
        <Line color="mutedForeground">
          <Text size="sm" color="primary">
            Draft:
          </Text>{" "}
          {state.draft.replaceAll("\n", " ")}
        </Line>
      );
    case "idle": {
      const { id, agent } = chatAgentOf(chat);
      return <LastLine chat={chat} unread={unread} agentName={agentNameOf(agents, id, agent)} />;
    }
  }
}

/** The last message: yours with its ticks, the agent's (in full color while unread), or what came on its own. */
function LastLine({
  chat,
  unread,
  agentName,
}: {
  chat: Conversation;
  unread: boolean;
  agentName: string;
}) {
  const last = lastMessage(chat);
  const color = unread ? "foreground" : "mutedForeground";
  if (!last) return <Line color="mutedForeground">{chatRowDetail(chat, agentName)}</Line>;
  if (last.turn.role === "user")
    return (
      <Line color={color}>
        <Text size="sm" color={last.answered ? "primary" : "mutedForeground"}>
          {last.answered ? "✓✓" : "✓"}
        </Text>{" "}
        {last.text}
      </Line>
    );
  if (last.turn.error === STOPPED)
    return (
      <Line icon="stop.circle" color="mutedForeground">
        Stopped
      </Line>
    );
  const delivered = last.turn.delivered;
  if (delivered?.kind === "automation")
    return (
      <Line icon="clock" color={color}>
        {delivered.name && delivered.name !== chat.title ? `${delivered.name}: ` : ""}
        {last.text}
      </Line>
    );
  if (delivered?.kind === "message")
    return (
      <Line icon="paperplane" color={color}>
        {last.text}
      </Line>
    );
  return <Line color={color}>{last.text}</Line>;
}

function StateBadge({ state, unread }: { state: RowState; unread: boolean }) {
  const theme = useTheme();
  const activity = state.kind === "activity" ? state.activity.kind : null;
  if (activity === "approval" || activity === "input")
    return <Badge color="warning" label="Needs you" />;
  if (state.kind === "failed" && unread) return <Badge color="error" label="Failed" />;
  if (activity) return <Spinner size="mini" color="primary" />;
  if (!unread) return null;
  return (
    <View
      accessible
      accessibilityLabel="Unread"
      style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }}
    />
  );
}

function Badge({ color, label }: { color: ColorToken; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors[color],
      }}
    >
      <Icon name="exclamationmark" size={11} weight="heavy" color="canvas" />
    </View>
  );
}

const styles = StyleSheet.create({
  badges: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
