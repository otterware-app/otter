import type { Platform } from "@otter/core";
import {
  addNotificationResponseReceivedListener,
  dismissNotificationAsync,
  getPresentedNotificationsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setBadgeCountAsync,
  setNotificationHandler,
} from "expo-notifications";

import { emit } from "./bridge.ts";

/**
 * Local notifications and the app's badge. Core sends one only when it means it to show, so it
 * shows in front too; tapping an agent's opens its chat. Asks for permission at the first.
 */
export function localNotifications(): Pick<
  Platform,
  "notify" | "dismissNotification" | "setUnreadCount"
> {
  setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  addNotificationResponseReceivedListener(({ notification }) => {
    const chat = notification.request.content.data?.chat;
    if (typeof chat === "string") emit("agent:openChat", chat);
  });

  return {
    notify(notification) {
      void (async () => {
        if (!(await requestPermissionsAsync()).granted) return;
        await scheduleNotificationAsync({
          ...(notification.id ? { identifier: notification.id } : {}),
          content: {
            title: notification.title,
            subtitle: notification.subtitle,
            body: notification.body,
            sound: notification.silent ? false : "default",
            threadIdentifier: notification.chat ?? notification.category,
            data: { chat: notification.chat, open: notification.open },
          },
          trigger: null,
        });
      })().catch((err: unknown) => console.warn("Couldn't notify:", err));
    },
    dismissNotification(match) {
      void (async () => {
        if (match.id) await dismissNotificationAsync(match.id);
        if (!match.chat) return;
        for (const shown of await getPresentedNotificationsAsync())
          if (shown.request.content.data?.chat === match.chat)
            await dismissNotificationAsync(shown.request.identifier);
      })().catch(() => {});
    },
    setUnreadCount: (count) => void setBadgeCountAsync(count).catch(() => {}),
  };
}
