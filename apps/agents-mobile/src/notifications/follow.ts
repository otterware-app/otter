import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { useAgentNotificationsMode } from "@otter/client/agents/agent-settings";
import { useChats } from "@otter/client/agents/chat-store";
import { pushPointer, pushShows, pushedChat } from "@otter/client/agents/notifications";
import { pushTrigger, setAgentNotificationPolicy } from "@otter/mobile/notifications";
import {
  DEFAULT_ACTION_IDENTIFIER,
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  getLastNotificationResponse,
  type NotificationResponse,
} from "expo-notifications";
import { useRootNavigationState } from "expo-router";
import { useEffect } from "react";

import { FAKE } from "../core.ts";
import { openChat } from "../frame/navigation.ts";
import { deviceNotificationsEnabled, followDeviceRegistration } from "./device.ts";
import { followNotificationFaces } from "./faces.ts";
import { notificationsNative } from "./native.ts";

/** Installs the account's foreground policy and handles a tap when the router is ready. */
export function useFollowAgentNotifications(userId: string | null | undefined) {
  const navigationKey = useRootNavigationState()?.key;
  const { mode } = useAgentNotificationsMode();

  useEffect(() => {
    if (FAKE || userId === undefined) return;
    return followNotificationFaces(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const enabled = () => deviceNotificationsEnabled() && mode !== "off";
    setAgentNotificationPolicy({
      userId,
      enabled,
      present(notification) {
        const { watched, conversations } = useChats.getState();
        const push = pushTrigger(notification);
        const pointer = pushPointer(push?.payload?.otter, userId);
        const data = notification.request.content.data;
        const show =
          enabled() &&
          (push
            ? pointer !== null &&
              !pointer.resolved &&
              pushShows(
                pointer,
                mode ?? "all",
                conversations.find((chat) => chat.id === watched),
              )
            : data?.userId === userId && data?.chat !== watched);
        return {
          shouldShowBanner: show,
          shouldShowList: false,
          shouldPlaySound: show && pointer?.kind !== "finished",
          shouldSetBadge: false,
        };
      },
    });
    return () => setAgentNotificationPolicy(null);
  }, [userId, mode]);

  useEffect(() => {
    if (userId === undefined || !navigationKey) return;
    let active = true;
    let opened: string | undefined;
    function tapped(response: NotificationResponse) {
      clearLastNotificationResponse();
      if (!userId || response.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return;
      const { notification } = response;
      if (notification.request.identifier === opened) return;
      const data = notification.request.content.data;
      const push = pushTrigger(notification);
      if (!push) {
        if (typeof data?.chat === "string" && data.userId === userId) {
          opened = notification.request.identifier;
          openChat(data.chat);
        }
        return;
      }
      const pointer = pushPointer(push.payload?.otter, userId);
      if (!pointer) return;
      const id = (opened = notification.request.identifier);
      void pushedChat(pointer)
        .then((chat) => {
          if (active && id === opened && chat) openChat(chat.id);
        })
        .catch(report);
    }
    const subscription = addNotificationResponseReceivedListener(tapped);
    const last = getLastNotificationResponse();
    if (last) tapped(last);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [userId, navigationKey]);
}

/** The signed-in account's device registration and the alerts it has already seen. */
export function AgentNotificationDevice({ userId }: { userId: string }) {
  const providers = useAgentProviders().data?.providers;
  const connected = providers?.some((agent) => agent.status === "ready") ?? false;

  useEffect(() => {
    if (!FAKE) return followDeviceRegistration(userId, connected);
  }, [userId, connected]);

  useEffect(() => {
    if (FAKE) return;
    let last: string | null = null;
    function clear() {
      const { watched, conversations } = useChats.getState();
      const session = watched ? conversations.find((chat) => chat.id === watched)?.sessionId : null;
      if (session === last) return;
      last = session ?? null;
      if (session) void notificationsNative.clearSession(session).catch(report);
    }
    clear();
    return useChats.subscribe(clear);
  }, []);

  return null;
}

const report = (error: unknown) => console.warn("Agent notifications", error);
