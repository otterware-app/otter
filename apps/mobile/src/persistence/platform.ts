import type {
  AsyncContext,
  ByteStream,
  GoogleAuth,
  MicrosoftAuth,
  Platform,
  SqlDatabase,
  SqlValue,
} from "@otter-mail/core";
import { createCredentials } from "@otter-mail/mobile-credentials";
import { createMailSocket } from "@otter-mail/mobile-socket";
import { openSqlite, type SqliteValue } from "@otter-mail/mobile-sqlite";
import type { WorkerHost } from "@otter-mail/mobile-worker";

import * as fakeGmail from "../../../web/src/web/demo/gmail";

/**
 * Core's Platform on the phone, inside the worker runtime: the mail cache in
 * SQLite (otter-sqlite), files in Application Support, mail servers over
 * otter-socket, and sign-ins from the Keychain (otter-credentials), which
 * hands out access tokens and keeps refresh tokens to itself.
 */

export type Shell = {
  broadcast(channel: string, params?: unknown): void;
  effect(effect: { kind: "notify" | "badge"; [key: string]: unknown }): void;
  onResume(listener: () => void): () => void;
};

export type MobilePlatformOptions = {
  host: WorkerHost;
  shell: Shell;
  appVersion: string;
  relayUrl: string;
  demo: boolean;
};

const SIGN_IN_LATER = "Signing in on the phone isn't built yet (phase 1).";

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
    addAccount: () => Promise.reject(new Error(SIGN_IN_LATER)),
    cancelSignIn() {},
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
    addAccount: () => Promise.reject(new Error(SIGN_IN_LATER)),
    cancelSignIn() {},
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

export async function mobilePlatform(options: MobilePlatformOptions): Promise<Platform> {
  const { host, shell } = options;
  const root = options.demo ? "demo" : "mail";
  const database = openDatabase(`${host.dataDirectory}/${root}-cache.db`);
  const credentials = createCredentials();

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

  const demo = options.demo ? fakeGmail : null;
  if (demo) await demo.installFakeGmail(files);

  return {
    kind: "web",
    appVersion: options.appVersion,
    log: (level, scope, message, data) =>
      host.log(level, `[${scope}] ${message}${data === undefined ? "" : ` ${describe(data)}`}`),
    database: () => database,
    files,
    secrets: {
      get: async (name) => credentials.getSecret(`${root}:${name}`) ?? null,
      set: async (name, value) => credentials.setSecret(`${root}:${name}`, value),
      delete: async (name) => credentials.deleteSecret(`${root}:${name}`),
    },
    userFiles: {
      open: () => Promise.reject(new Error("Opening files isn't built on the phone yet.")),
      save: async () => false,
      pick: async () => [],
    },
    google: demo ? demo.demoGoogleAuth() : keychainGoogleAuth(),
    microsoft: demo ? undefined : keychainMicrosoftAuth(),
    connect: demo
      ? () => Promise.reject(new Error("The demo can't connect to mail servers."))
      : connectMailServer,
    relayUrl: demo ? demo.DEMO_RELAY_URL : options.relayUrl,
    relaySession: "bearer",
    deviceName: "iPhone",
    broadcast: shell.broadcast,
    notify: (notification) => shell.effect({ kind: "notify", ...notification }),
    setUnreadCount: (count) => shell.effect({ kind: "badge", count }),
    onResume: shell.onResume,
    asyncContext: noContext,
    offlineDownloads: false,
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
