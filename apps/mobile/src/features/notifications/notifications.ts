import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter-mail/contracts";
import type { HostEffect } from "@otter-mail/contracts/rpc";
import { createCredentials } from "@otter-mail/mobile-credentials";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Linking } from "react-native";

import type { core as coreBridge } from "../../state/core";

type Core = typeof coreBridge;
type Settings = { notificationsMode?: "off" | "inbox" | "all" };
type PushConfiguration = { userId: string; mode: string; mailboxes: string[] };

/** Where a notification opens: the Swift app's Session.NotificationDestination, or an agent's chat. */
export type Destination =
  | { userId?: string; accountId: string; messageId?: string; threadId?: string }
  | { chat: string };

const appVariant = (Constants.expoConfig?.extra as { appVariant?: string } | undefined)?.appVariant;
const scheme = String(Constants.expoConfig?.scheme ?? "ottermail");

function pushConfiguration(): PushConfiguration | null {
  const json = createCredentials().pushConfiguration();
  return json ? (JSON.parse(json) as PushConfiguration) : null;
}

/** PushState.permits: the extension may announce mail for this account and mailbox. */
function permits(userId: string, email: string): boolean {
  const config = pushConfiguration();
  return (
    config?.userId === userId &&
    config.mode !== "off" &&
    config.mailboxes.includes(email.toLowerCase())
  );
}

/** A push's userInfo (expo-notifications' `data` is Expo's push service `body` key), or a local one's data. */
function userInfo(request: Notifications.NotificationRequest): Record<string, unknown> {
  const trigger = request.trigger as { type?: string; payload?: Record<string, unknown> } | null;
  return (trigger?.type === "push" ? trigger.payload : request.content.data) ?? {};
}

/** The relay's push (`otter`, enriched by the extension with `mailbox`, `message`, `thread`) or core's `notify`. */
export function destination(data: Record<string, unknown>): Destination | null {
  const otter = data.otter as
    | {
        userId?: string;
        email?: string;
        provider?: string;
        messageId?: string;
        folder?: string;
        uidValidity?: number;
      }
    | undefined;
  if (otter?.email) {
    // Unenriched, an IMAP push names the UID; core's id is VerifiedNotification's `validity:uid:folder`.
    const pushed =
      otter.provider === "imap" && otter.messageId && otter.folder && otter.uidValidity
        ? `${otter.uidValidity}:${otter.messageId}:${otter.folder}`
        : otter.messageId;
    return {
      userId: otter.userId,
      accountId: otter.email,
      messageId: (data.message as string | undefined) ?? pushed,
      threadId: data.thread as string | undefined,
    };
  }
  if (typeof data.chat === "string" && data.chat) return { chat: data.chat };
  const open = data.open as { accountId?: string; messageId?: string } | undefined;
  return open?.accountId ? { accountId: open.accountId, messageId: open.messageId } : null;
}

/** The mailbox, then the thread, as the Swift app's prepareNotification does. */
async function openDestination(core: Core, target: Destination): Promise<void> {
  if ("chat" in target) {
    await Linking.openURL(
      `${scheme}://chat?${new URLSearchParams({ id: target.chat }).toString()}`,
    );
    return;
  }
  // Another Otter account's push, from before signing out here.
  if (target.userId && pushConfiguration()?.userId !== target.userId) return;
  let threadId = target.threadId;
  let subject = "";
  if (target.messageId) {
    const message = await core
      .invoke<{ threadId: string; subject: string } | null>("gmail:getMessage", {
        accountId: target.accountId,
        messageId: target.messageId,
      })
      .catch(() => null);
    threadId ??= message?.threadId;
    subject = message?.subject ?? "";
  }
  if (!threadId) return;
  const query = new URLSearchParams({ accountId: target.accountId, threadId, subject });
  await Linking.openURL(`${scheme}://thread?${query.toString()}`);
}

let registering = false;
let again = false;
/** Session.apnsToken: asked of iOS once, then as it rotates. */
let apnsToken: string | null = null;
/** MailSync.pushMailboxes: mailboxes the relay pushes for, which get no local notification too. */
let pushed = new Set<string>();

/**
 * Session.requestNotifications and updatePushRegistration: asks once to show
 * notifications while they're on, then hands this iPhone's APNs token to core,
 * which writes what the extension may enrich and registers it on the relay.
 */
async function registerPush(core: Core): Promise<void> {
  if (registering) {
    again = true;
    return;
  }
  registering = true;
  try {
    const { notificationsMode = "inbox" } = await core.invoke<Settings>("gmail:getSyncSettings");
    let permissions = await Notifications.getPermissionsAsync();
    if (notificationsMode !== "off" && permissions.canAskAgain && !permissions.granted) {
      permissions = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
    }
    const state = await core.invoke<OtterAccountState>("otter:getState");
    if (state.user && !apnsToken) {
      const { data } = await Notifications.getDevicePushTokenAsync();
      if (typeof data === "string" && data) apnsToken = data;
    }
    const token = state.user ? apnsToken : null;
    const result = await core.invoke<{ mode?: string; mailboxes?: string[] }>(
      "push:register",
      token
        ? {
            token,
            topic: Constants.expoConfig?.ios?.bundleIdentifier,
            environment: appVariant === "development" ? "sandbox" : "production",
            enabled: permissions.granted,
          }
        : null,
    );
    pushed = new Set(result.mode && result.mode !== "off" ? result.mailboxes : []);
  } catch (error) {
    console.log(`[push] registration failed: ${String(error)}`);
  } finally {
    registering = false;
    if (again) {
      again = false;
      void registerPush(core);
    }
  }
}

/** HostEffect `notify` and `badge`: core's local notifications and the unread count on the icon. */
export function deviceEffect(core: Core, effect: HostEffect): boolean {
  switch (effect._tag) {
    case "badge":
      void core
        .invoke<Settings>("gmail:getSyncSettings")
        .then(({ notificationsMode }) =>
          Notifications.setBadgeCountAsync(notificationsMode === "off" ? 0 : effect.count),
        )
        .catch(() => {});
      return true;
    case "notify":
      if (effect.open && pushed.has(effect.open.accountId.toLowerCase())) return true;
      void Notifications.scheduleNotificationAsync({
        content: {
          title: effect.title,
          ...(effect.subtitle ? { subtitle: effect.subtitle } : {}),
          ...(effect.body ? { body: effect.body } : {}),
          sound: "default",
          data: {
            ...(effect.open ? { open: effect.open } : {}),
            ...(effect.code ? { code: effect.code } : {}),
            ...(effect.chat ? { chat: effect.chat } : {}),
          },
          ...(effect.open ? { threadIdentifier: effect.open.accountId } : {}),
        },
        trigger: null,
      }).catch((error: unknown) => console.log(`[notify] failed: ${String(error)}`));
      return true;
    default:
      return false;
  }
}

const REGISTER_ON = new Set([
  OTTER_ACCOUNT_STATE_CHANNEL,
  "gmail:accounts-changed",
  "settings:changed",
  "connections:changed",
]);

/**
 * Push and local notifications: foreground presentation as the Swift app's
 * AppDelegate decides it, taps open their thread, and the registration
 * follows the account, its mailboxes and Settings.
 */
export function startNotifications(core: Core, ready: Promise<unknown>): void {
  Notifications.setNotificationHandler({
    async handleNotification(notification) {
      const data = userInfo(notification.request);
      const otter = data.otter as { userId?: string; email?: string } | undefined;
      const { notificationsMode } = await core
        .invoke<Settings>("gmail:getSyncSettings")
        .catch(() => ({ notificationsMode: undefined }));
      let show = notificationsMode !== "off";
      if (otter) {
        // A change marker alone doesn't merit a banner; mail catches up either way.
        show &&= data.message !== undefined && permits(otter.userId ?? "", otter.email ?? "");
        void core.invoke("background:refresh", { budgetMs: 20_000 }).catch(() => {});
      }
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  const handled = new Set<string>();
  const open = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (handled.has(id)) return;
    handled.add(id);
    const target = destination(userInfo(response.notification.request));
    if (target) void ready.then(() => openDestination(core, target)).catch(() => {});
  };
  Notifications.addNotificationResponseReceivedListener(open);
  // The tap that launched the app.
  void Notifications.getLastNotificationResponseAsync().then((last) => {
    if (!last) return;
    open(last);
    void Notifications.clearLastNotificationResponseAsync();
  });

  // Fires for the token `getDevicePushTokenAsync` hands back too: only a new one re-registers.
  Notifications.addPushTokenListener(({ data }) => {
    if (typeof data !== "string" || !data || data === apnsToken) return;
    apnsToken = data;
    void ready.then(() => registerPush(core));
  });
  void ready.then(() => registerPush(core));
  let timer: ReturnType<typeof setTimeout> | null = null;
  core.on("*", (event) => {
    if (!REGISTER_ON.has((event as { channel: string }).channel)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void registerPush(core), 1000);
  });
  AppState.addEventListener("change", (state) => {
    if (state === "active") void ready.then(() => registerPush(core));
  });
}
