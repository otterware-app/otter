import { listen } from "@otter/client/bridge";
import { mailApi } from "@otter/client/mail/api";
import { aliasMailboxesOf } from "@otter/client/mail/alias-mailboxes";
import { useOtterAccount } from "@otter/client/otter-account";
import { pushTrigger, setMailNotificationPolicy } from "@otter/mobile/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  DEFAULT_ACTION_IDENTIFIER,
  getLastNotificationResponse,
  type Notification,
  type NotificationResponse,
} from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";

import { benchmark, fake } from "../core.ts";
import { useMailboxes } from "../mail/mailboxes.ts";
import { configureMailRefresh } from "./background-refresh.ts";
import { followMailDevice, pushMailboxes } from "./mail-device.ts";

export const mailSettingsKey = ["settings:mail"];

export function useNotificationConnections(userId: string | undefined) {
  return useQuery({
    queryKey: ["notification-connections", userId],
    queryFn: mailApi.notificationConnections,
    enabled: !fake && Boolean(userId),
    refetchInterval: userId && !fake ? 15_000 : false,
  });
}

function pushMail(notification: Notification) {
  const data = notification.request.content.data;
  const push = pushTrigger(notification)?.payload;
  const metadata = data?.otter ?? push?.otter;
  if (metadata === null || typeof metadata !== "object") return null;
  const { version, userId, email } = metadata as Record<string, unknown>;
  if ((version !== 1 && version !== 2) || typeof userId !== "string" || typeof email !== "string")
    return null;
  const mailbox = data?.mailbox ?? push?.mailbox;
  const thread = data?.thread ?? push?.thread;
  const message = data?.message ?? push?.message;
  return {
    userId,
    email: email.toLowerCase(),
    alias: typeof mailbox === "string" ? mailbox.toLowerCase() : undefined,
    thread: typeof thread === "string" ? thread : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function localMail(notification: Notification) {
  const open = notification.request.content.data?.open;
  if (!open || typeof open !== "object") return null;
  const { accountId, messageId, mailbox } = open as Record<string, unknown>;
  return typeof accountId === "string" && typeof messageId === "string"
    ? { accountId, messageId, alias: typeof mailbox === "string" ? mailbox : undefined }
    : null;
}

export function useMailNotifications() {
  const queries = useQueryClient();
  const account = useOtterAccount();
  const userId = account?.user?.id;
  const mailboxes = useMailboxes();
  const connections = useNotificationConnections(userId);
  const settings = useQuery({
    queryKey: mailSettingsKey,
    queryFn: mailApi.getSyncSettings,
    enabled: !benchmark,
  });
  const mode = settings.data?.notificationsMode;
  const router = useRouter();
  const navigationKey = useRootNavigationState()?.key;
  useEffect(() => {
    if (benchmark) return;
    return listen(
      "settings:changed",
      () => void queries.invalidateQueries({ queryKey: mailSettingsKey }),
    );
  }, [queries]);
  const wantRefresh =
    account && mailboxes.isSuccess
      ? Boolean(
          userId &&
          mailboxes.mailboxes.some(({ account, enabled }) => enabled && !account.signedOut),
        )
      : undefined;

  useEffect(() => {
    if (wantRefresh !== undefined) configureMailRefresh(wantRefresh);
  }, [wantRefresh]);
  const configuration =
    userId && mode && connections.data && mailboxes.isSuccess
      ? JSON.stringify({
          userId,
          mode,
          ...pushMailboxes(mailboxes.mailboxes, connections.data.connections),
        })
      : account && !userId
        ? null
        : undefined;
  const fakeEmails = fake
    ? mailboxes.mailboxes
        .filter(({ enabled }) => enabled)
        .map(({ account }) => account.email.toLowerCase())
        .join("\n")
    : "";

  useEffect(() => {
    if (fake || configuration === undefined) return;
    return followMailDevice(
      configuration ? (JSON.parse(configuration) as Parameters<typeof followMailDevice>[0]) : null,
    );
  }, [configuration]);

  const { refetch } = connections;
  useEffect(() => {
    if (fake || !userId) return;
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void refetch();
    });
    return () => foreground.remove();
  }, [userId, refetch]);

  useEffect(() => {
    if (benchmark) return;
    const configured = configuration
      ? (JSON.parse(configuration) as { mailboxes: string[] }).mailboxes
      : fakeEmails.split("\n");
    setMailNotificationPolicy((notification) => {
      const push = pushTrigger(notification);
      const incoming = pushMail(notification);
      const show =
        mode !== undefined &&
        mode !== "off" &&
        (push
          ? incoming?.userId === userId &&
            Boolean(incoming?.message) &&
            configured.includes(incoming?.email ?? "")
          : true);
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    });
    return () => setMailNotificationPolicy(null);
  }, [configuration, userId, mode, fakeEmails]);

  const ready = Boolean(account && !mailboxes.isPending && navigationKey);
  useEffect(() => {
    if (!ready || benchmark) return;
    let opened: string | undefined;
    let active = true;
    async function tapped({ actionIdentifier, notification }: NotificationResponse) {
      if (
        actionIdentifier !== DEFAULT_ACTION_IDENTIFIER ||
        opened === notification.request.identifier
      )
        return;
      const incoming = pushMail(notification);
      const local = localMail(notification);
      if ((incoming && incoming.userId !== userId) || (!incoming && !local)) return;
      opened = notification.request.identifier;
      const entries = await mailApi.listAccounts();
      const next = entries.find(({ id, email }) =>
        incoming ? email.toLowerCase() === incoming.email : id === local?.accountId,
      );
      if (!active || !next || next.signedOut) return;
      const messageId = incoming?.message ?? local?.messageId;
      const thread =
        incoming?.thread ??
        (messageId ? (await mailApi.getMessage(next.id, messageId))?.threadId : undefined);
      if (!active || !thread) return;
      const alias = aliasMailboxesOf(next, entries).find(
        ({ id }) => id === (incoming?.alias ?? local?.alias),
      );
      clearLastNotificationResponse();
      router.push({
        pathname: "/mail/[account]/[label]/[thread]",
        params: { account: alias?.id ?? next.id, label: "INBOX", thread },
      });
    }
    const open = (response: NotificationResponse) =>
      void tapped(response).catch((error: unknown) =>
        console.warn("Couldn't open notification", error),
      );
    const subscription = addNotificationResponseReceivedListener(open);
    const last = getLastNotificationResponse();
    if (last) open(last);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, userId, router]);
}
