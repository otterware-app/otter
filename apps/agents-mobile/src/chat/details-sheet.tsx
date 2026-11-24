import { useChatProvider } from "@otter/client/agents/agent-providers";
import { keyOf, useScheduledTasks } from "@otter/client/agents/agent-scheduled";
import {
  DETAILS_SHOWN,
  chatDetails,
  chatTasks,
  tabTitle,
  taskLine,
} from "@otter/client/agents/chat-details";
import { loadChat, useChats, type Conversation } from "@otter/client/agents/chat-store";
import type { ChatTab } from "@otter/contracts/chats";
import { showNotice } from "@otter/mobile/notices";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { useTheme } from "@otter/ui-native/theme";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";

const TAB_ICONS: Record<ChatTab["ref"]["kind"], IconName> = {
  thread: "envelope",
  draft: "square.and.pencil",
  page: "globe",
  file: "doc",
};

/** Mail opens where the chat's mail can: Otter on the web. */
const inOtter = (chatId: string) => `https://otter.otterware.app/agents/${chatId}`;

/** What a chat is and what it touched (ChatDetails.swift): its agent, where it ran, what it made and read. */
export function DetailsSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convo = useChats((s) => s.conversations.find((c) => c.id === id));
  const loaded = convo?.loaded ?? true;

  useEffect(() => {
    if (!loaded) void loadChat(id);
  }, [id, loaded]);

  return (
    <Sheet title="Chat details" onCancel={() => router.back()} cancelLabel="Close">
      {convo ? <Details convo={convo} /> : null}
    </Sheet>
  );
}

function Details({ convo }: { convo: Conversation }) {
  const { agent, agentName, about, outputs, sources } = chatDetails(convo, useChatProvider(convo));
  const sessionId = convo.sessionId;
  const mail = convo.tabs.some((t) => t.ref.kind === "thread" || t.ref.kind === "draft");

  const open = (tab: ChatTab) => {
    const { ref } = tab;
    if (ref.kind === "page") {
      void WebBrowser.openBrowserAsync(ref.url);
    } else if (ref.kind === "file") {
      router.replace({ pathname: "/agents/[id]/file", params: { id: convo.id, path: ref.href } });
    } else {
      void Linking.openURL(inOtter(convo.id));
    }
  };

  return (
    <>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 }}
        accessible
      >
        <AgentAvatar agent={convo.provider} gatewayAgent={agent} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="lg" weight="semibold" numberOfLines={1}>
            {agentName}
          </Text>
          {about ? (
            <Text size="sm" color="mutedForeground" numberOfLines={1}>
              {about}
            </Text>
          ) : null}
        </View>
      </View>
      {sessionId ? (
        <Card>
          <Row
            icon="doc.on.doc"
            title="Copy session ID"
            onPress={() => {
              void Clipboard.setStringAsync(sessionId);
              haptics.done();
              showNotice({ tone: "success", title: "Session ID copied" });
            }}
          />
        </Card>
      ) : null}
      {sessionId ? <Scheduled sessionId={sessionId} /> : null}
      <TabSection title="Outputs" empty="Nothing made yet" tabs={outputs} onOpen={open} />
      <TabSection title="Sources" empty="Nothing read yet" tabs={sources} onOpen={open} />
      {mail ? (
        <Card>
          <Row
            icon="arrow.up.right.square"
            title="Open this chat in Otter"
            onPress={() => void Linking.openURL(inOtter(convo.id))}
          />
        </Card>
      ) : null}
    </>
  );
}

function TabSection({
  title,
  empty,
  tabs,
  onOpen,
}: {
  title: string;
  empty: string;
  tabs: ChatTab[];
  onOpen: (tab: ChatTab) => void;
}) {
  const [all, setAll] = useState(false);
  return (
    <Section title={title}>
      <Card>
        {tabs.length === 0 ? (
          <View style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 16 }}>
            <Text size="md" color="mutedForeground">
              {empty}
            </Text>
          </View>
        ) : null}
        {(all ? tabs : tabs.slice(0, DETAILS_SHOWN)).map((tab) => (
          <Row
            key={tab.id}
            icon={TAB_ICONS[tab.ref.kind]}
            title={tabTitle(tab) || tab.ref.kind.charAt(0).toUpperCase() + tab.ref.kind.slice(1)}
            chevron={tab.ref.kind === "page"}
            inactive={tab.closedAt != null}
            onPress={() => onOpen(tab)}
          />
        ))}
        {tabs.length > DETAILS_SHOWN ? (
          <Pressable
            onPress={() => setAll(!all)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text size="sm" weight="medium" color="mutedForeground">
              {all ? "Show fewer" : `View all ${tabs.length}`}
            </Text>
          </Pressable>
        ) : null}
      </Card>
    </Section>
  );
}

/** What the agent runs on a schedule for this chat: made in it, or posting to it. */
function Scheduled({ sessionId }: { sessionId: string }) {
  const tasks = chatTasks(useScheduledTasks(true).data ?? [], sessionId);
  const [now] = useState(Date.now);
  if (tasks.length === 0) return null;
  return (
    <Section title="Scheduled">
      <Card>
        {tasks.map((task) => (
          <Row
            key={keyOf(task)}
            icon="clock"
            title={task.name}
            subtitle={taskLine(task, now)}
            chevron
            onPress={() => {
              router.back();
              router.navigate({ pathname: "/scheduled/[id]", params: { id: keyOf(task) } });
            }}
          />
        ))}
      </Card>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        size="sm"
        weight="medium"
        color="mutedForeground"
        accessibilityRole="header"
        style={{ paddingHorizontal: 8 }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius["3xl"],
        borderCurve: "continuous",
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  chevron = false,
  inactive = false,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  chevron?: boolean;
  inactive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: subtitle ? 8 : 0,
        minHeight: 48,
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={17} color="mutedForeground" style={{ width: 22 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text size="base" color={inactive ? "mutedForeground" : "foreground"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text size="body" color="mutedForeground" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {chevron ? (
        <Icon name="chevron.right" size={13} weight="semibold" color="faintForeground" />
      ) : null}
    </Pressable>
  );
}
