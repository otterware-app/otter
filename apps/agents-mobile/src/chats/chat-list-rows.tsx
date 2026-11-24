import { bringBackChat, snoozeChat } from "@otter/client/agents/chat-actions";
import { snoozePresets } from "@otter/client/agents/chat-shelves";
import {
  markChatsSeen,
  markChatUnseen,
  pinChat,
  type Conversation,
} from "@otter/client/agents/chat-store";
import type { SearchRange } from "@otter/shared/chat-search";
import { Icon } from "@otter/ui-native/components/icon";
import { SwipeRow } from "@otter/ui-native/components/swipe-row";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { Link } from "expo-router";
import type { ReactNode } from "react";
import { ActionSheetIOS, Pressable, StyleSheet, View } from "react-native";

import { HeldRow, type RowAction } from "../frame/held-row.tsx";
import { openChat } from "../frame/navigation.ts";
import { useChatMenu, type ChatMenuEntry } from "./chat-menu.ts";
import { ChatPreview } from "./chat-preview.tsx";
import { ChatRow } from "./chat-row.tsx";

/** A chat's menu as a row's context menu: its sections inline, a divider between each. */
function menuElements(sections: ChatMenuEntry[][]): ReactNode[] {
  const entry = (e: ChatMenuEntry): ReactNode =>
    "entries" in e ? (
      <Link.Menu key={e.title} title={e.title} icon={e.icon}>
        {e.entries.map(entry)}
      </Link.Menu>
    ) : (
      <Link.MenuAction
        key={e.title}
        icon={e.icon}
        subtitle={e.detail}
        destructive={e.destructive}
        onPress={e.onPress}
      >
        {e.title}
      </Link.MenuAction>
    );
  return sections.map((section) => (
    <Link.Menu key={section[0]?.title} inline>
      {section.map(entry)}
    </Link.Menu>
  ));
}

/** The same menu as VoiceOver's actions: Snooze's times as "Snooze, In 1 hour". */
function menuActions(sections: ChatMenuEntry[][]): RowAction[] {
  const actions = (e: ChatMenuEntry, within?: string): RowAction[] =>
    "entries" in e
      ? e.entries.flatMap((sub) => actions(sub, e.title))
      : [{ name: within ? `${within}, ${e.title}` : e.title, run: e.onPress }];
  return sections.flat().flatMap((e) => actions(e));
}

/** Snooze's times, from its swipe (ChatsScreen.swift's swipe Menu). */
function chooseSnooze(chat: Conversation) {
  const presets = snoozePresets(new Date());
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Snooze until",
      options: [...presets.map((p) => `${p.label} · ${p.when}`), "Cancel"],
      cancelButtonIndex: presets.length,
    },
    (index) => {
      const preset = presets[index];
      if (preset) void snoozeChat(chat.id, preset.until);
    },
  );
}

function Pressed({
  onPress,
  selected,
  label,
  children,
}: {
  onPress?: () => void;
  selected?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        backgroundColor:
          selected || pressed ? alpha(theme.colors.foreground, 0.05) : theme.colors.canvas,
      })}
    >
      {children}
    </Pressable>
  );
}

/** A chat on its shelf: opened by a tap, swiped, touched and held for its preview and menu, or picked while selecting. */
export function ListedChat({
  chat,
  now,
  showAgent,
  shelf,
  selecting,
  picked,
  toggle,
  unread,
  settle,
  settled,
}: {
  chat: Conversation;
  now: number;
  showAgent: boolean;
  shelf: "active" | "snoozed" | "settled";
  selecting: boolean;
  picked: boolean;
  toggle: () => void;
  unread: boolean;
  settle: () => void;
  settled: (chat: Conversation) => void;
}) {
  const theme = useTheme();
  const menu = useChatMenu(chat, { settled });
  if (selecting)
    return (
      <Pressed onPress={toggle} selected={picked}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 56, paddingLeft: 16 }}>
            <Icon
              name={picked ? "checkmark.circle.fill" : "circle"}
              size={24}
              color={picked ? "primary" : "faintForeground"}
            />
          </View>
          <View style={{ flex: 1 }}>
            <ChatRow chat={chat} now={now} showAgent={showAgent} />
          </View>
        </View>
      </Pressed>
    );
  const read = unread
    ? { title: "Read", icon: "checkmark.message" as const, run: () => markChatsSeen([chat.id]) }
    : { title: "Unread", icon: "message.badge" as const, run: () => markChatUnseen(chat.id) };
  const pinned = chat.pinnedAt != null;
  const leading = [
    { title: read.title, icon: read.icon, tint: theme.colors.primary, onPerform: read.run },
    {
      title: pinned ? "Unpin" : "Pin",
      icon: pinned ? ("pin.slash" as const) : ("pin" as const),
      tint: theme.colors.mutedForeground,
      onPerform: () => void pinChat(chat.id, !pinned),
    },
  ];
  const trailing =
    shelf === "active"
      ? [
          {
            title: "Settle",
            icon: "archivebox" as const,
            tint: theme.colors.primary,
            onPerform: settle,
          },
          {
            title: "Snooze",
            icon: "clock" as const,
            tint: theme.colors.mutedForeground,
            onPerform: () => chooseSnooze(chat),
          },
        ]
      : {
          title: shelf === "snoozed" ? "Wake" : "Unsettle",
          icon: shelf === "snoozed" ? ("bell" as const) : ("arrow.uturn.backward" as const),
          tint: theme.colors.primary,
          onPerform: () => void bringBackChat(chat.id),
        };
  return (
    <HeldRow
      open={() => openChat(chat.id)}
      actions={[
        { name: unread ? "Mark as read" : "Mark as unread", run: read.run },
        ...menuActions(menu),
      ]}
    >
      <SwipeRow square leading={leading} trailing={trailing}>
        <Link href={{ pathname: "/agents/[id]", params: { id: chat.id } }} asChild>
          <Link.Trigger>
            <Pressed>
              <ChatRow chat={chat} now={now} showAgent={showAgent} />
            </Pressed>
          </Link.Trigger>
          <Link.Preview style={{ width: 320, height: 380, backgroundColor: theme.colors.canvas }}>
            <ChatPreview id={chat.id} />
          </Link.Preview>
          <Link.Menu>
            <Link.Menu inline>
              {unread ? (
                <Link.MenuAction icon="checkmark.message" onPress={read.run}>
                  Mark as read
                </Link.MenuAction>
              ) : (
                <Link.MenuAction icon="message.badge" onPress={read.run}>
                  Mark as unread
                </Link.MenuAction>
              )}
            </Link.Menu>
            {menuElements(menu)}
          </Link.Menu>
        </Link>
      </SwipeRow>
    </HeldRow>
  );
}

/** A chat a search found, by its title or one of its messages. */
export function SearchedChat({
  chat,
  now,
  showAgent,
  titleRanges,
  excerpt,
  open,
}: {
  chat: Conversation;
  now: number;
  showAgent: boolean;
  titleRanges: readonly SearchRange[];
  excerpt?: { text: string; ranges: readonly SearchRange[] };
  open: () => void;
}) {
  return (
    <Pressed onPress={open}>
      <ChatRow
        chat={chat}
        now={now}
        showAgent={showAgent}
        titleRanges={titleRanges}
        excerpt={excerpt}
      />
    </Pressed>
  );
}

/** A new chat you started writing: at the top of Active until it's sent or discarded. */
export function DraftRow({
  chat,
  draft,
  discard,
}: {
  chat: Conversation;
  draft: string;
  discard: () => void;
}) {
  const theme = useTheme();
  return (
    <HeldRow open={() => openChat(chat.id)} actions={[{ name: "Discard draft", run: discard }]}>
      <SwipeRow
        square
        trailing={{ title: "Discard", icon: "trash", tint: theme.colors.error, onPerform: discard }}
      >
        <Link href={{ pathname: "/agents/[id]", params: { id: chat.id } }} asChild>
          <Link.Trigger>
            <Pressed label={`Unsent draft: ${draft}`}>
              <View style={{ paddingHorizontal: 16 }}>
                <View
                  style={{
                    paddingVertical: 12,
                    gap: 3,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: alpha(theme.colors.mutedForeground, 0.2),
                  }}
                >
                  <Text size="base" weight="semibold">
                    New chat
                  </Text>
                  <Text size="md" color="mutedForeground" numberOfLines={2}>
                    <Text size="md" color="primary">
                      Draft:
                    </Text>{" "}
                    {draft}
                  </Text>
                </View>
              </View>
            </Pressed>
          </Link.Trigger>
          <Link.Menu>
            <Link.MenuAction icon="trash" destructive onPress={discard}>
              Discard draft
            </Link.MenuAction>
          </Link.Menu>
        </Link>
      </SwipeRow>
    </HeldRow>
  );
}
