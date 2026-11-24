import type { ProvidersState } from "@otter/client/agents/api";
import { activityStatus, chatActivity } from "@otter/client/agents/chat-list";
import { isBlank, useChats, type Conversation } from "@otter/client/agents/chat-store";
import { Text } from "@otter/ui-native/components/text";
import { Stack, router, useCanGoBack } from "expo-router";
import { Pressable, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useChatMenu, type ChatMenuEntry } from "../chats/chat-menu.ts";
import { useChatAgent } from "./chat-agent.ts";

/** WhatsApp's header: the chat's name, and what the agent is doing as "online" or "typing…" would be. Tap for details. */
export function ChatHeader({
  chat,
  agents,
  onFind,
}: {
  chat: Conversation;
  agents: ProvidersState | undefined;
  onFind: () => void;
}) {
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const menu = useChatMenu(chat, { settled: leaveChat, deleted: leaveChat });
  // Opened by a link (or after a reload) the chat is its stack's only screen: back goes to the chats.
  const alone = !useCanGoBack();
  const blank = isBlank(chat);
  const title = blank ? "New chat" : chat.title;
  const activity = chatActivity({ runs, approvals, questions }, chat);
  const { id: agent, provider, gatewayAgent, label: name } = useChatAgent(chat.id);
  const status = activity
    ? activityStatus(activity)
    : [name, provider && provider.name !== name ? provider.name : null, chat.device?.name || null]
        .filter(Boolean)
        .join(" · ");
  const details = () => {
    if (!blank) router.push({ pathname: "/agents/[id]/details", params: { id: chat.id } });
  };
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitle: "",
          headerBackVisible: true,
          // ChatScreen.swift's glass header: the transcript passes under it, softened at the edge.
          headerTransparent: true,
          headerStyle: { backgroundColor: "transparent" },
        }}
      />
      <Stack.Toolbar placement="left">
        {alone ? (
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Back" onPress={leaveChat} />
        ) : null}
        <Stack.Toolbar.View hidesSharedBackground>
          <Pressable
            accessibilityRole={blank ? "header" : "button"}
            accessibilityLabel={blank ? title : "Chat details"}
            accessibilityValue={{
              text: blank ? status : [title, status].filter(Boolean).join(", "),
            }}
            accessibilityHint={blank ? undefined : "Shows the chat's details"}
            onPress={blank ? undefined : details}
            style={{
              width: 240,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingLeft: 4,
            }}
          >
            <AgentAvatar
              agent={agent}
              gatewayAgent={gatewayAgent}
              kind={provider ? undefined : agents?.others.find((o) => o.id === agent)?.kind}
              size={30}
            />
            <View style={{ flex: 1 }}>
              <Text size="base" weight="semibold" numberOfLines={1}>
                {title}
              </Text>
              <Text size="xs" color={activity ? "primary" : "mutedForeground"} numberOfLines={1}>
                {status}
              </Text>
            </View>
          </Pressable>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      {blank ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
            <Stack.Toolbar.Menu inline>
              <Stack.Toolbar.MenuAction icon="info.circle" onPress={details}>
                Chat details
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="magnifyingglass" onPress={onFind}>
                Find in chat
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
            {menu.map((section) => (
              <Stack.Toolbar.Menu key={section.map((entry) => entry.title).join()} inline>
                {section.map((entry) => (
                  <MenuEntry key={entry.title} entry={entry} />
                ))}
              </Stack.Toolbar.Menu>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
    </>
  );
}

/** Back to the chats, from wherever the chat was opened. */
export function leaveChat() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

function MenuEntry({ entry }: { entry: ChatMenuEntry }) {
  if ("entries" in entry)
    return (
      <Stack.Toolbar.Menu title={entry.title} icon={entry.icon}>
        {entry.entries.map((child) => (
          <MenuEntry key={child.title} entry={child} />
        ))}
      </Stack.Toolbar.Menu>
    );
  return (
    <Stack.Toolbar.MenuAction
      icon={entry.icon}
      subtitle={entry.detail}
      destructive={entry.destructive}
      onPress={entry.onPress}
    >
      {entry.title}
    </Stack.Toolbar.MenuAction>
  );
}
