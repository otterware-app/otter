import { isProviderUsable, useAgentProviders } from "@otter/client/agents/agent-providers";
import {
  bringBackChat,
  regenerateChatTitle,
  renameChatAs,
  settleChat,
  snoozeChat,
} from "@otter/client/agents/chat-actions";
import { agentNameOf, chatsWaitingOnYou } from "@otter/client/agents/chat-list";
import { chatShelf, snoozePresets, useNow } from "@otter/client/agents/chat-shelves";
import {
  deleteConversation,
  pinChat,
  useChats,
  type Conversation,
} from "@otter/client/agents/chat-store";
import { useAutoSettleDays } from "@otter/client/agents/auto-settle";
import { host } from "@otter/client/host";
import type { IconName } from "@otter/ui-native/components/icon";
import * as Clipboard from "expo-clipboard";
import { ActionSheetIOS, Alert } from "react-native";

/** One entry of a chat's menu: something to do, or a menu of more (Snooze's times). */
export type ChatMenuEntry =
  | { title: string; detail?: string; icon?: IconName; destructive?: boolean; onPress: () => void }
  | { title: string; icon?: IconName; entries: ChatMenuEntry[] };

/**
 * A chat's menu, the same on its row in the list and in the chat itself (ChatActions.swift's
 * ChatMenu): its sections, a divider between each. Whoever shows it draws the entries with its
 * own menu (a row's `Link.Menu`, a header's `Stack.Toolbar.Menu`).
 */
export function useChatMenu(
  chat: Conversation,
  on: { settled?: (chat: Conversation) => void; deleted?: (chat: Conversation) => void } = {},
): ChatMenuEntry[][] {
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const autoSettleDays = useAutoSettleDays();
  const now = useNow(30_000);
  const agents = useAgentProviders().data;
  const provider = agents?.providers.find((p) => p.id === chat.provider);
  const needsYou = chatsWaitingOnYou({ runs, approvals, questions }).has(chat.id);
  const shelf = chatShelf(chat, {
    working: Boolean(runs[chat.id]),
    needsYou,
    now,
    autoSettleDays,
  });

  const shelving: ChatMenuEntry[] = [
    chat.pinnedAt == null
      ? { title: "Pin", icon: "pin", onPress: () => void pinChat(chat.id, true) }
      : { title: "Unpin", icon: "pin.slash", onPress: () => void pinChat(chat.id, false) },
  ];
  if (shelf === "snoozed")
    shelving.push({
      title: "Wake up now",
      icon: "clock",
      onPress: () => void bringBackChat(chat.id),
    });
  if (shelf === "settled")
    shelving.push({
      title: "Unsettle",
      icon: "arrow.uturn.backward",
      onPress: () => void bringBackChat(chat.id),
    });
  shelving.push({
    title: shelf === "snoozed" ? "Snooze until" : "Snooze",
    icon: "clock",
    entries: snoozePresets(new Date(now)).map((preset) => ({
      title: preset.label,
      detail: preset.when,
      onPress: () => void snoozeChat(chat.id, preset.until),
    })),
  });
  if (shelf !== "settled")
    shelving.push({
      title: "Settle",
      icon: "checkmark",
      onPress: () => {
        on.settled?.(chat);
        void settleChat(chat.id);
      },
    });

  const naming: ChatMenuEntry[] = [
    {
      title: "Rename",
      icon: "pencil",
      onPress: () =>
        Alert.prompt(
          "Rename chat",
          undefined,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Rename",
              isPreferred: true,
              onPress: (title?: string) =>
                renameChatAs(chat.id, title ?? "", provider?.titles ?? false),
            },
          ],
          "plain-text",
          chat.title,
        ),
    },
  ];
  if (chat.sessionId && isProviderUsable(provider))
    naming.push({
      title: "Regenerate title",
      icon: "sparkles",
      onPress: () => void regenerateChatTitle(chat.id),
    });
  const session = chat.sessionId;
  if (session)
    naming.push({
      title: "Copy session ID",
      icon: "doc.on.doc",
      onPress: () => {
        void Clipboard.setStringAsync(session);
        host().notice({ tone: "success", title: "Session ID copied" });
      },
    });

  const agentName = agentNameOf(agents, chat.provider, null);
  const removing: ChatMenuEntry[] = [
    {
      title: "Delete",
      icon: "trash",
      destructive: true,
      onPress: () =>
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: "Delete chat?",
            message:
              chat.sessionOwned && provider?.kind !== "varys"
                ? `“${chat.title}” goes from every device, and its session from ${agentName}.`
                : `“${chat.title}” goes from every device.`,
            options: ["Delete", "Cancel"],
            destructiveButtonIndex: 0,
            cancelButtonIndex: 1,
          },
          (index) => {
            if (index !== 0) return;
            on.deleted?.(chat);
            deleteConversation(chat.id, chat.provider);
          },
        ),
    },
  ];

  return [shelving, naming, removing];
}
