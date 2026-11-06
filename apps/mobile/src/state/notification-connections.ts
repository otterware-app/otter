import type { NotificationConnection } from "@otter-mail/contracts/relay";
import { authorize } from "@otter-mail/mobile-account";
import { useEffect, useState } from "react";

import { core } from "./core";

/**
 * Background notifications per mailbox (the Swift app's Session.notificationConnections):
 * the relay watches a mailbox with a limited grant (Gmail, Outlook) or its
 * IMAP password, and the providers it can watch at all.
 */
export type NotificationConnections = {
  connections: NotificationConnection[];
  providers: Record<string, boolean>;
};

const NONE: NotificationConnections = { connections: [], providers: {} };

/** MailboxSettings' status line. */
export function notificationStatus(status: string | undefined): string {
  switch (status) {
    case "ready":
      return "Connected";
    case "connecting":
      return "Checking…";
    case "retry":
      return "Retrying connection";
    case "reauthorize":
      return "Reconnect required";
    default:
      return "Not connected";
  }
}

export const connectionOf = (all: NotificationConnections, email: string) =>
  all.connections.find((c) => c.email.toLowerCase() === email.toLowerCase());

/** The connections, asked again every 5 seconds while shown (a grant's check finishes on the relay). */
const loadConnections = (set: (value: NotificationConnections) => void) =>
  core.invoke<NotificationConnections>("otter:notificationConnections").then(set, () => {});

export function useNotificationConnections(): [NotificationConnections, () => Promise<void>] {
  const [value, setValue] = useState(NONE);
  useEffect(() => {
    void loadConnections(setValue);
    const timer = setInterval(() => void loadConnections(setValue), 5000);
    return () => clearInterval(timer);
  }, []);
  return [value, () => loadConnections(setValue)];
}

/**
 * Connects a mailbox: IMAP sends its password to the relay; Gmail and Outlook
 * ask the provider for the limited grant in a browser sheet, which comes back
 * on ottermail-notifications://. False when cancelled.
 */
export async function connectNotifications(accountId: string): Promise<boolean> {
  const result = await core.invoke<{ url?: string; connected?: boolean }>(
    "otter:connectNotifications",
    { accountId },
  );
  if (!result.url) return true;
  const callback = await authorize(result.url, "ottermail-notifications");
  if (callback === null) return false;
  if (/[?&]result=([^&#]*)/.exec(callback)?.[1] !== "success") {
    throw new Error(
      "Notification setup didn't finish. Select the same mailbox and approve the limited access.",
    );
  }
  return true;
}

export const disconnectNotifications = (accountId: string) =>
  core.invoke("otter:disconnectNotifications", { accountId });

/**
 * Session.offerNotifications: right after adding Gmail or Outlook, the limited
 * grant's sheet (while notifications are on, and the relay can watch it). The
 * mailbox works either way, so a cancelled or failed grant is let go.
 */
export async function offerNotifications(account: {
  id: string;
  email: string;
  provider?: string;
}) {
  try {
    const { notificationsMode } = await core.invoke<{ notificationsMode?: string }>(
      "gmail:getSyncSettings",
    );
    const all = await core.invoke<NotificationConnections>("otter:notificationConnections");
    const provider = account.provider ?? "gmail";
    if (
      notificationsMode === "off" ||
      provider === "imap" ||
      !all.providers[provider] ||
      connectionOf(all, account.email)?.status === "ready"
    ) {
      return;
    }
    await connectNotifications(account.id);
  } catch {
    // the mailbox is added; its page offers notifications again
  }
}
