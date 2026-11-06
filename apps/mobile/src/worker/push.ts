import { validAliasMailboxes, type AliasMailbox, type ImapSettings } from "@otter-mail/contracts";
import type { NotificationConnection, PutPushDeviceRequest } from "@otter-mail/contracts/relay";
import {
  getOtterUser,
  getSettings,
  handle,
  logger,
  relayRequest,
  turnedOffMailboxes,
  type MailAccount,
} from "@otter-mail/core";
import { createCredentials } from "@otter-mail/mobile-credentials";

import { call } from "./call";

/** The Swift app's NotificationShared PushState.Configuration: what the notification extension enriches. */
export type PushConfiguration = {
  userId: string;
  mode: string;
  mailboxes: string[];
  imapSettings?: Record<string, ImapSettings>;
  aliases?: Record<string, AliasMailbox[]>;
  names?: Record<string, string>;
};

export type PushRegistration = {
  token: string;
  topic: string;
  environment: PutPushDeviceRequest["environment"];
  /** Notifications are allowed in iOS Settings. */
  enabled: boolean;
};

/**
 * Session.configurePush and updatePushRegistration in the Swift app: the
 * mailboxes this iPhone can verify (signed in here, their notification
 * connection ready), written to the App Group for the notification extension,
 * then this device's registration on the relay.
 */
export function pushConfiguration(
  userId: string,
  mode: string,
  accounts: MailAccount[],
  connections: NotificationConnection[],
  off: ReadonlySet<string>,
): PushConfiguration {
  const status = new Map(connections.map((c) => [c.email.toLowerCase(), c.status]));
  const shown = accounts.filter((a) => !off.has(a.id));
  const emails = shown.map((a) => a.email);
  const available = shown.filter(
    (a) => !a.signedOut && ["ready", "retry"].includes(status.get(a.email.toLowerCase()) ?? ""),
  );
  const imapSettings: Record<string, ImapSettings> = {};
  const aliases: Record<string, AliasMailbox[]> = {};
  for (const account of available) {
    const email = account.email.toLowerCase();
    if (account.imap) imapSettings[email] = account.imap;
    const own = validAliasMailboxes(account, emails).filter(
      (alias) => !off.has(alias.address.toLowerCase()),
    );
    if (own.length) aliases[email] = own;
  }
  const scopes =
    shown.length +
    shown.reduce(
      (n, a) =>
        n + validAliasMailboxes(a, emails).filter((x) => !off.has(x.address.toLowerCase())).length,
      0,
    );
  return {
    userId,
    mode,
    mailboxes: available.map((a) => a.email.toLowerCase()),
    ...(Object.keys(imapSettings).length ? { imapSettings } : {}),
    ...(Object.keys(aliases).length ? { aliases } : {}),
    ...(scopes > 1
      ? {
          names: Object.fromEntries(
            available.map((a) => [a.email.toLowerCase(), a.displayName || a.name || a.email]),
          ),
        }
      : {}),
  };
}

let registering: Promise<unknown> = Promise.resolve();

async function register(registration: PushRegistration | null) {
  const credentials = createCredentials();
  const user = getOtterUser();
  if (!user) {
    credentials.configurePush(undefined);
    return {};
  }
  const [{ notificationsMode }, accounts, { connections }] = await Promise.all([
    getSettings(),
    call<MailAccount[]>("gmail:listAccounts"),
    call<{ connections: NotificationConnection[] }>("otter:notificationConnections"),
  ]);
  const config = pushConfiguration(
    user.id,
    notificationsMode,
    accounts,
    connections,
    turnedOffMailboxes(),
  );
  credentials.configurePush(JSON.stringify(config));
  if (!registration) return {};
  const mode = registration.enabled ? (config.mode as PutPushDeviceRequest["mode"]) : "off";
  await relayRequest("PUT", "/v1/push/device", {
    token: registration.token,
    topic: registration.topic,
    environment: registration.environment,
    mode,
    mailboxes: config.mailboxes,
  } satisfies PutPushDeviceRequest);
  logger.info("push", `registered (${mode}) for ${config.mailboxes.length} mailboxes`);
  return { mode, mailboxes: config.mailboxes };
}

/**
 * `push:register`: the UI's APNs token (null before it has one), again
 * whenever the account, its mailboxes or Settings change.
 */
export function registerPushHandlers(): void {
  handle("push:register", (params) => {
    const next = registering
      .catch(() => {})
      .then(() => register(params as PushRegistration | null));
    registering = next;
    return next;
  });
}
