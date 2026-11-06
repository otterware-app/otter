import {
  accountStore,
  KEEP_RECENT,
  SignInCancelledError,
  type AsyncContext,
  type ByteStream,
  type CoreHost,
  type GoogleAuth,
  type MailAccount,
  type MicrosoftAuth,
  type Platform,
  type SqlDatabase,
  type SqlValue,
} from "@otter-mail/core";
import { createCredentials } from "@otter-mail/mobile-credentials";
import { serializeError, type ReportTags } from "@otter-mail/shared/error-reports";
import { createMailSocket } from "@otter-mail/mobile-socket";
import { openSqlite, type SqliteValue } from "@otter-mail/mobile-sqlite";
import type { WorkerHost } from "@otter-mail/mobile-worker";

import * as fakeGmail from "../../../web/src/web/demo/gmail";
import { connectDemoImap, DEMO_IMAP } from "../worker/demo-imap";
import type { WorkerConfig } from "../worker/protocol";

/**
 * Core's Platform on the phone, inside the worker runtime: the mail cache in
 * SQLite (otter-sqlite), files in Application Support, mail servers over
 * otter-socket, and sign-ins from the Keychain (otter-credentials), which
 * signs in natively, hands out access tokens and keeps refresh tokens to
 * itself. What needs the UI goes to it over core's RPC (`shell`).
 */

export type Shell = Pick<CoreHost, "broadcast" | "effect" | "request"> & {
  onResume(listener: () => void): () => void;
};

export type MobilePlatformOptions = {
  host: WorkerHost;
  shell: Shell;
  config: WorkerConfig;
};

const cancelled = (error: unknown) => error instanceof Error && error.message === "cancelled";

export function openDatabase(path: string): SqlDatabase {
  const db = openSqlite(path);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => ({
      get: (...params) =>
        db.get(sql, params as SqliteValue[]) as Record<string, SqlValue> | undefined,
      all: (...params) => db.all(sql, params as SqliteValue[]) as Record<string, SqlValue>[],
      run: (...params) => db.run(sql, params as SqliteValue[]),
    }),
  };
}

export function connectMailServer(
  host: string,
  port: number,
  opts: { tls: boolean },
): Promise<ByteStream> {
  const socket = createMailSocket();
  return socket.connect(host, port, opts.tls).then(() => ({
    read: async () => {
      const chunk = await socket.read();
      return chunk ? new Uint8Array(chunk) : null;
    },
    write: (data) =>
      socket.write(
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? (data.buffer as ArrayBuffer)
          : (data.slice().buffer as ArrayBuffer),
      ),
    startTls: () => socket.startTls(),
    close: () => socket.close(),
  }));
}

function keychainGoogleAuth(): GoogleAuth {
  const credentials = createCredentials();
  return {
    async load() {},
    async addAccount(loginHint) {
      const profile = await credentials.signInGoogle(loginHint).catch((error: unknown) => {
        throw cancelled(error) ? new SignInCancelledError() : error;
      });
      // Signing in again keeps what the mailbox already had (its name, color, signature).
      const existing = await accountStore.getAccount(profile.email);
      const account: MailAccount = {
        ...(existing && (existing.provider ?? "gmail") === "gmail" ? existing : {}),
        id: profile.email,
        email: profile.email,
        name: profile.name ?? profile.email,
        picture: profile.picture,
      };
      await accountStore.addAccount(account);
      return account;
    },
    signInForIdToken: () =>
      credentials.googleIdTokenSignIn().catch((error: unknown) => {
        throw cancelled(error) ? new SignInCancelledError() : error;
      }),
    cancelSignIn: () => credentials.cancelSignIn(),
    isSignedIn: (accountId) => credentials.hasGoogle(accountId),
    getAccessToken: async (accountId, opts) =>
      (await credentials.googleAccessToken(accountId, opts?.forceRefresh === true)).accessToken,
    async getIdToken(accountId) {
      const token = await credentials.googleAccessToken(accountId, false);
      if (!token.idToken) throw new Error("This sign-in has no ID token.");
      return token.idToken;
    },
    async removeTokens(accountId) {
      credentials.forgetGoogle(accountId);
    },
  };
}

function keychainMicrosoftAuth(): MicrosoftAuth {
  const credentials = createCredentials();
  return {
    available: async () => true,
    async load() {},
    async addAccount(loginHint) {
      const profile = await credentials.signInMicrosoft(loginHint).catch((error: unknown) => {
        throw cancelled(error) ? new SignInCancelledError() : error;
      });
      return { email: profile.email, name: profile.name ?? profile.email };
    },
    cancelSignIn: () => credentials.cancelSignIn(),
    isSignedIn: (accountId) => credentials.hasMicrosoft(accountId),
    getAccessToken: async (accountId, opts) =>
      (await credentials.microsoftAccessToken(accountId, opts?.forceRefresh === true)).accessToken,
    async getIdToken(accountId) {
      const token = await credentials.microsoftAccessToken(accountId, false);
      if (!token.idToken) throw new Error("This sign-in has no ID token.");
      return token.idToken;
    },
    async removeTokens(accountId) {
      credentials.forgetMicrosoft(accountId);
    },
  };
}

const noContext = <T>(): AsyncContext<T> => ({ run: (_value, fn) => fn(), get: () => undefined });

/**
 * The Swift app's demo: the pretend Gmail accounts, and the iCloud-shaped IMAP
 * mailbox with its alias mailboxes on the pretend IMAP server (demo-imap.ts).
 */
function demoGoogleAuth(setPassword: (accountId: string) => Promise<void>): GoogleAuth {
  const auth = fakeGmail.demoGoogleAuth();
  return {
    ...auth,
    async load() {
      const fresh = (await accountStore.listAccounts()).length === 0;
      await auth.load();
      if (!fresh) return;
      const { threads: _, labels: __, ...seed } = DEMO_IMAP;
      await accountStore.addAccount({ ...seed, id: seed.email, provider: "imap" });
      await setPassword(seed.email);
    },
  };
}

function connectDemo(host: string): Promise<ByteStream> {
  return host === DEMO_IMAP.imap.imap.host
    ? Promise.resolve(connectDemoImap())
    : Promise.reject(new Error("The demo can't connect to mail servers."));
}

export async function mobilePlatform(options: MobilePlatformOptions): Promise<Platform> {
  const { host, shell, config } = options;
  const root = config.demo ? "demo" : "mail";
  const database = openDatabase(`${host.dataDirectory}/${root}-cache.db`);
  const credentials = createCredentials();
  const secretName = (name: string) => (config.demo ? `demo:${name}` : name);

  const files: Platform["files"] = {
    read: async (path) => {
      const bytes = host.readFile(`${root}/${path}`);
      return bytes ? new Uint8Array(bytes) : null;
    },
    write: async (path, data) => {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      host.writeFile(`${root}/${path}`, bytes.slice().buffer as ArrayBuffer);
    },
    remove: async (path) => host.removeFile(`${root}/${path}`),
    list: async (dir) => host.listFiles(`${root}/${dir}`),
  };

  const demo = config.demo ? fakeGmail : null;
  if (demo) await demo.installFakeGmail(files);

  return {
    kind: "ios",
    appVersion: config.appVersion,
    log(level, scope, message, data) {
      host.log(level, `[${scope}] ${message}${data === undefined ? "" : ` ${describe(data)}`}`);
      if (level === "debug") return;
      // For the UI's Sentry, as apps/web's worker reports.
      const wrapped = data as { error?: unknown; tags?: ReportTags } | null;
      const error = data instanceof Error ? data : wrapped?.error;
      const tags = data instanceof Error ? undefined : wrapped?.tags;
      shell.effect({ _tag: "report", level, scope, message, error: serializeError(error), tags });
    },
    database: () => database,
    files,
    // Under the names the notification extension reads (`imap-password:<email>`); the demo's apart.
    secrets: {
      get: async (name) => credentials.getSecret(secretName(name)) ?? null,
      set: async (name, value) => credentials.setSecret(secretName(name), value),
      delete: async (name) => credentials.deleteSecret(secretName(name)),
    },
    google: demo
      ? demoGoogleAuth(async (id) =>
          credentials.setSecret(secretName(`imap-password:${id}`), "demo"),
        )
      : keychainGoogleAuth(),
    microsoft: demo ? undefined : keychainMicrosoftAuth(),
    connect: demo ? connectDemo : connectMailServer,
    rawSockets: true,
    crossOriginFetch: true,
    notificationReturn: "native",
    syncPolicy: KEEP_RECENT,
    inForeground: () => config.inForeground.getDirty(),
    relayUrl: demo ? demo.DEMO_RELAY_URL : config.relayUrl,
    relaySession: "bearer",
    agentServerUrl: config.agentServerUrl,
    deviceName: "iPhone",
    broadcast: shell.broadcast,
    notify: (notification) => shell.effect({ _tag: "notify", ...notification }),
    setUnreadCount: (count) => shell.effect({ _tag: "badge", count }),
    translator: {
      detect: (text) => shell.request("detectLanguage", { text }),
      translate: (texts, source, target) => shell.request("translate", { texts, source, target }),
    },
    onResume: shell.onResume,
    asyncContext: noContext,
    userFiles: {
      open: async (name, bytes) => shell.effect({ _tag: "open", name, bytes }),
      save: (name, bytes) => shell.request("saveFile", { name, bytes }),
      pick: () => shell.request("pickFiles", {}),
    },
  };
}

function describe(data: unknown): string {
  if (data instanceof Error) return `${data.message}\n${data.stack ?? ""}`;
  const wrapped = data as { error?: unknown } | null;
  if (wrapped?.error instanceof Error)
    return `${wrapped.error.message}\n${wrapped.error.stack ?? ""}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
