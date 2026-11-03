/**
 * Reaching an account's IMAP and SMTP servers. Each account keeps one command
 * connection, opened when first needed, reused while there's work and logged
 * out after two idle minutes (IDLE has its own, watch.ts). The protocol
 * client runs one command at a time and the selected folder is connection
 * state, so whole operations (select, then fetch) take turns here: what the
 * user just did first, then sync, then offline downloads.
 */

import type { ImapSettings } from "@otter-mail/contracts";

import { platform, type AsyncContext } from "../../platform.js";
import {
  connectImap,
  ImapClient,
  ImapError,
  MailProtocolError,
  type ImapOptions,
  type SelectedMailbox,
  type SmtpOptions,
} from "../../protocols/index.js";
import { getAccount } from "../../services/account-store.js";
import { getImapPassword, setAsideImapPassword } from "../../services/imap-passwords.js";
import type { Lane } from "../provider.js";

const IDLE_CLOSE_MS = 2 * 60_000;

export type ImapAccess = { settings: ImapSettings; password: string };

let tierContext: AsyncContext<Lane> | null = null;
export const tier = (): AsyncContext<Lane> => (tierContext ??= platform().asyncContext<Lane>());
const RANK = { user: 0, sync: 1, backfill: 2, prefetch: 3 } as const;

type Connection = {
  client: ImapClient | null;
  busy: boolean;
  waiting: { rank: number; start: () => void }[];
  idleTimer?: ReturnType<typeof setTimeout>;
};

const connections = new Map<string, Connection>();

export const failedServer = new WeakMap<object, { host: string; user: string }>();

export class NeedsPassword extends Error {
  constructor(email: string) {
    super(`Enter the password for ${email} to sync it.`);
  }
}

export const isSignInFailure = (err: unknown): boolean =>
  err instanceof NeedsPassword || (err instanceof MailProtocolError && err.kind === "auth");

export function noteSignInFailure(accountId: string, access: ImapAccess, err: unknown): void {
  if (err instanceof MailProtocolError && err.kind === "auth") {
    setAsideImapPassword(accountId, access.password, err.message);
  }
}

export async function accessFor(accountId: string): Promise<ImapAccess> {
  const account = await getAccount(accountId);
  if (!account?.imap) throw new Error(`${accountId} isn't an IMAP mailbox.`);
  const password = getImapPassword(accountId);
  if (!password) throw new NeedsPassword(account.email);
  return { settings: account.imap, password };
}

export function imapOptions({ settings, password }: ImapAccess): ImapOptions {
  return {
    ...settings.imap,
    auth: { user: settings.username, pass: password },
    clientId: { name: "Otter Mail", vendor: "Otterware" },
  };
}

export function smtpOptions({ settings, password }: ImapAccess): SmtpOptions {
  return { ...settings.smtp, auth: { user: settings.username, pass: password } };
}

export function tagFailure(err: unknown, host: string, user: string): unknown {
  if (err instanceof MailProtocolError && !failedServer.has(err)) {
    failedServer.set(err, { host, user });
  }
  return err;
}

export async function openImap(accountId: string): Promise<ImapClient> {
  const access = await accessFor(accountId);
  try {
    const client = await connectImap(imapOptions(access));
    await client.enable(["CONDSTORE", "QRESYNC"]);
    return client;
  } catch (err) {
    noteSignInFailure(accountId, access, err);
    throw tagFailure(err, access.settings.imap.host, access.settings.username);
  }
}

function connectionFor(accountId: string): Connection {
  let connection = connections.get(accountId);
  if (!connection) {
    connection = { client: null, busy: false, waiting: [] };
    connections.set(accountId, connection);
  }
  return connection;
}

async function acquire(connection: Connection): Promise<void> {
  if (!connection.busy) {
    connection.busy = true;
    return;
  }
  const rank = RANK[tier().get() ?? "user"];
  await new Promise<void>((start) => {
    const at = connection.waiting.findIndex((w) => w.rank > rank);
    connection.waiting.splice(at < 0 ? connection.waiting.length : at, 0, { rank, start });
  });
}

function release(connection: Connection): void {
  const next = connection.waiting.shift();
  if (next) {
    next.start();
    return;
  }
  connection.busy = false;
  clearTimeout(connection.idleTimer);
  connection.idleTimer = setTimeout(() => {
    if (connection.busy || !connection.client) return;
    void connection.client.logout();
    connection.client = null;
  }, IDLE_CLOSE_MS);
}

const isConnectionFailure = (err: unknown) =>
  err instanceof MailProtocolError && (err.kind === "network" || err.kind === "timeout");

/**
 * Runs `fn` on the account's command connection once it's this caller's
 * turn. A reused connection the server dropped meanwhile is reopened and
 * `fn` tried once more, unless `retry` is false (APPEND: never twice).
 */
export async function withImap<T>(
  accountId: string,
  fn: (client: ImapClient) => Promise<T>,
  opts: { retry?: boolean } = {},
): Promise<T> {
  const connection = connectionFor(accountId);
  await acquire(connection);
  clearTimeout(connection.idleTimer);
  try {
    const reused = connection.client?.isOpen === true;
    if (!reused) connection.client = await openImap(accountId);
    try {
      return await fn(connection.client!);
    } catch (err) {
      if (!connection.client?.isOpen) connection.client = null;
      if (!reused || opts.retry === false || !isConnectionFailure(err)) throw err;
      connection.client = await openImap(accountId);
      return await fn(connection.client);
    }
  } catch (err) {
    const access = await accessFor(accountId).catch(() => null);
    if (access) tagFailure(err, access.settings.imap.host, access.settings.username);
    throw err;
  } finally {
    release(connection);
  }
}

/** A folder was recreated (new UIDVALIDITY) while we worked in it: the next sync starts it over. */
export class FolderChanged extends Error {
  constructor(path: string) {
    super(`${path} changed on the server; syncing it again.`);
  }
}

export class FolderGone extends Error {
  constructor(path: string, options?: { cause?: unknown }) {
    super(`The folder ${path} is gone.`, options);
  }
}

/** Selects `path` unless it already is; with `uidValidity`, insists it's still that folder. */
export async function selectFolder(
  client: ImapClient,
  path: string,
  uidValidity?: number,
): Promise<SelectedMailbox> {
  let mailbox = client.mailbox;
  if (mailbox?.path !== path || mailbox.readOnly) {
    try {
      mailbox = await client.select(path);
    } catch (err) {
      if (err instanceof ImapError && err.status === "NO")
        throw new FolderGone(path, { cause: err });
      throw err;
    }
  }
  if (uidValidity !== undefined && mailbox.uidValidity !== uidValidity) {
    throw new FolderChanged(path);
  }
  return mailbox;
}

export const isMessageIdHeader = (value: string | null | undefined): value is string =>
  !!value && /^<[^<>\s]+>$/.test(value);

/**
 * The selected folder's messages whose Message-ID is exactly `header`, UIDs
 * ascending. SEARCH HEADER matches substrings, so its answers are checked.
 */
export async function findByMessageId(client: ImapClient, header: string): Promise<number[]> {
  if (!isMessageIdHeader(header)) return [];
  const found = await client.search({ messageId: header, deleted: false });
  if (found.length === 0) return [];
  const fetched = await client.fetch(found, { envelope: true });
  return fetched
    .filter((m) => m.envelope?.messageId?.trim() === header)
    .map((m) => m.uid)
    .sort((a, b) => a - b);
}

/** `withImap` with `path` selected (and still at `uidValidity`, when given). */
export function inFolder<T>(
  accountId: string,
  path: string,
  fn: (client: ImapClient, mailbox: SelectedMailbox) => Promise<T>,
  opts: { uidValidity?: number; retry?: boolean } = {},
): Promise<T> {
  return withImap(
    accountId,
    async (client) => fn(client, await selectFolder(client, path, opts.uidValidity)),
    opts,
  );
}

export function closeImap(accountId: string): void {
  const connection = connections.get(accountId);
  connections.delete(accountId);
  if (!connection) return;
  clearTimeout(connection.idleTimer);
  void connection.client?.logout();
}
