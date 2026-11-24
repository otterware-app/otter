import { ipc } from "@otter/client/bridge";
import { getAccountDisplayName } from "@otter/client/mail/account-style";
import type { NotificationsMode } from "@otter/client/mail/api";
import type { PutPushDeviceRequest, NotificationConnection } from "@otter/contracts/relay";
import { native } from "@otter/mobile/native";
import { setMailPushAccounts } from "@otter/mobile/notifications";
import {
  addPushTokenListener,
  getDevicePushTokenAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  IosAuthorizationStatus,
} from "expo-notifications";
import { AppState } from "react-native";

import type { Mailbox } from "../mail/mailboxes.ts";

export function pushMailboxes(mailboxes: Mailbox[], connections: NotificationConnection[]) {
  const ready = new Set(
    connections
      .filter(({ status }) => status === "ready" || status === "retry")
      .map(({ email }) => email.toLowerCase()),
  );
  const shown = mailboxes.filter(({ enabled, account }) => enabled && !account.signedOut);
  const base = shown.filter(
    ({ account, alias }) => !alias && ready.has(account.email.toLowerCase()),
  );
  return {
    accountIds: base.map(({ account }) => account.id),
    mailboxes: base.map(({ account }) => account.email.toLowerCase()),
    imapSettings: Object.fromEntries(
      base.flatMap(({ account }) =>
        account.imap ? [[account.email.toLowerCase(), account.imap]] : [],
      ),
    ),
    aliases: Object.fromEntries(
      base.map(({ account }) => [
        account.email.toLowerCase(),
        shown
          .filter((entry) => entry.account.id === account.id && entry.alias)
          .map(({ alias, look }) => ({ address: alias, name: getAccountDisplayName(look) })),
      ]),
    ),
    names:
      shown.length > 1
        ? Object.fromEntries(
            base.map(({ account, look }) => [
              account.email.toLowerCase(),
              getAccountDisplayName(look),
            ]),
          )
        : undefined,
  };
}

type Configuration = ReturnType<typeof pushMailboxes> & { userId: string; mode: NotificationsMode };
let pending = Promise.resolve();
const report = (error: unknown) => console.warn("Mail notifications", error);

export function followMailDevice(configuration: Configuration | null) {
  const apns = native.mailPushConfig();
  if (!apns) return;
  const { topic, environment } = apns;
  let active = true;
  let revision = 0;
  let token: string | undefined;
  let registered: string | null | undefined;

  function update(allowed: boolean, request: number) {
    pending = pending
      .then(async () => {
        if (!active || request !== revision) return;
        if (!allowed) setMailPushAccounts([]);
        await native.writeMailPushConfiguration(
          configuration
            ? JSON.stringify({ ...configuration, mode: allowed ? configuration.mode : "off" })
            : null,
        );
        if (!configuration || !active || request !== revision) return;
        const device =
          allowed && token
            ? {
                topic,
                environment,
                token,
                mode: configuration.mode,
                mailboxes: configuration.mailboxes,
              }
            : null;
        if (allowed && !device) return;
        if (registered === (device?.token ?? null)) return;
        await ipc("otter:setMailPushDevice", {
          userId: configuration.userId,
          device,
        } satisfies { userId: string; device: PutPushDeviceRequest | null });
        registered = device?.token ?? null;
        if (active && request === revision)
          setMailPushAccounts(device ? configuration.accountIds : []);
      })
      .catch(report);
  }

  async function reconcile() {
    const request = ++revision;
    if (!configuration || configuration.mode === "off" || !configuration.mailboxes.length) {
      update(false, request);
      return;
    }
    const settings = await getPermissionsAsync();
    if (!active || request !== revision) return;
    const permission =
      settings.canAskAgain && !settings.granted ? await requestPermissionsAsync() : settings;
    if (!active || request !== revision) return;
    const allowed =
      permission.granted || permission.ios?.status === IosAuthorizationStatus.PROVISIONAL;
    if (allowed && !token) {
      // Write the extension policy immediately. APNs may take time to hand back a token.
      update(true, request);
      const { data } = await getDevicePushTokenAsync();
      if (!active || request !== revision) return;
      if (typeof data === "string") token = data;
    }
    update(allowed, request);
  }

  const refresh = () => void reconcile().catch(report);
  const tokens = addPushTokenListener(({ data }) => {
    if (typeof data !== "string") return;
    token = data;
    refresh();
  });
  const foreground = AppState.addEventListener("change", (state) => {
    if (state === "active") refresh();
  });
  refresh();
  return () => {
    active = false;
    setMailPushAccounts([]);
    tokens.remove();
    foreground.remove();
  };
}
