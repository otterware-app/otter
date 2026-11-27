import type { Platform } from "@otter/core";
import {
  dismissNotificationAsync,
  getPresentedNotificationsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  setBadgeCountAsync,
  setNotificationHandler,
  type Notification,
  type NotificationBehavior,
} from "expo-notifications";

type AgentNotificationPolicy = {
  userId: string;
  enabled(): boolean;
  present(notification: Notification): NotificationBehavior;
};

let agents: AgentNotificationPolicy | null = null;
let mail: ((notification: Notification) => NotificationBehavior) | null = null;
let mailWithPush: ReadonlySet<string> = new Set();

export function setAgentNotificationPolicy(policy: AgentNotificationPolicy | null): void {
  agents = policy;
}

export function setMailNotificationPolicy(
  policy: ((notification: Notification) => NotificationBehavior) | null,
): void {
  mail = policy;
}

export function setMailPushAccounts(accounts: readonly string[]): void {
  mailWithPush = new Set(accounts);
}

/** iOS passes the relay's custom APNs keys in the trigger payload. */
export function pushTrigger({ request }: Notification) {
  const trigger = request.trigger;
  return trigger && "type" in trigger && trigger.type === "push" ? trigger : null;
}

/**
 * Local notifications and the app's badge. Core sends one only when it means it to show, so it
 * shows in front too. The Agents app filters its alerts and handles taps.
 */
export function localNotifications(): Pick<
  Platform,
  "notify" | "dismissNotification" | "setUnreadCount"
> {
  setNotificationHandler({
    async handleNotification(notification) {
      const metadata = pushTrigger(notification)?.payload?.otter;
      const kind = (metadata as { kind?: unknown } | undefined)?.kind;
      const isAgent =
        kind === "agent" ||
        kind === "agent-clear" ||
        notification.request.content.data?.agentNotification === true;
      if (isAgent && agents) return agents.present(notification);
      if (!isAgent && mail) return mail(notification);
      return {
        shouldShowBanner: !isAgent,
        shouldShowList: !isAgent,
        shouldPlaySound: !isAgent,
        shouldSetBadge: false,
      };
    },
  });

  return {
    notify(notification) {
      if (
        notification.category === "mail" &&
        notification.open &&
        mailWithPush.has(notification.open.accountId)
      )
        return;
      void (async () => {
        const agent = notification.category === "agent" ? agents : null;
        if (notification.category === "agent" && !agent?.enabled()) return;
        if (!(await requestPermissionsAsync()).granted) return;
        if (agent && (agent !== agents || !agent.enabled())) return;
        await scheduleNotificationAsync({
          ...(notification.id ? { identifier: notification.id } : {}),
          content: {
            title: notification.title,
            subtitle: notification.subtitle,
            body: notification.body,
            sound: notification.silent ? false : "default",
            threadIdentifier: notification.chat ?? notification.category,
            data: {
              ...(notification.chat ? { chat: notification.chat } : {}),
              ...(notification.open ? { open: notification.open } : {}),
              ...(agent ? { agentNotification: true, userId: agent.userId } : {}),
            },
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
