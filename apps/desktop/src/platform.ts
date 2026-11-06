import { todoistSignIn } from "./services/todoist-oauth.js";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AsyncContext, Platform, SqlDatabase } from "@otter-mail/core";
import { KEEP_MAILBOX } from "@otter-mail/core";

import { appInfo } from "./backend-protocol.js";
import { logger } from "./logger.js";
import { broadcastToMain, requestMain, tellMain } from "./main-link.js";
import { backendOS } from "./os/backend.js";
import { googleAuth } from "./services/gmail-oauth.js";
import { connectMailSocket } from "./services/mail-socket.js";
import { microsoftAuth } from "./services/microsoft-oauth.js";
import { desktopSupportDiagnostics } from "./services/support-diagnostics.js";

const home = () => appInfo().stateDir;

async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Its own temp file each time: two writes at once mustn't rename each other's.
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

const SECRETS_FILE = "secrets.json";

/** One change to secrets.json at a time, so two can't each write over the other's. */
let secretsQueue: Promise<unknown> = Promise.resolve();
function changeSecrets(change: (secrets: Record<string, string>) => Promise<boolean>) {
  const next = secretsQueue.then(async () => {
    const secrets = await readSecrets();
    if (await change(secrets)) {
      await writeFileAtomic(path.join(home(), SECRETS_FILE), JSON.stringify(secrets, null, 2));
    }
  });
  secretsQueue = next.catch(() => {});
  return next;
}

async function readSecrets(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(path.join(home(), SECRETS_FILE), "utf-8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function openDatabase(): SqlDatabase {
  const db = new DatabaseSync(path.join(home(), "mail-cache.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  return db as unknown as SqlDatabase;
}

export const resumeListeners = new Set<() => void>();

export function desktopPlatform(): Platform {
  let database: SqlDatabase | null = null;
  return {
    kind: "desktop",
    supportDiagnostics: desktopSupportDiagnostics,
    appVersion: appInfo().version,
    errorReports: appInfo().errorReports,
    log: (level, scope, message, data) => logger[level](scope, message, data),

    database: () => (database ??= openDatabase()),
    connect: connectMailSocket,
    files: {
      async read(file) {
        try {
          return new Uint8Array(await fs.readFile(path.join(home(), file)));
        } catch {
          return null;
        }
      },
      write: (file, data) => writeFileAtomic(path.join(home(), file), data),
      remove: (file) => fs.rm(path.join(home(), file), { force: true }),
      async list(dir) {
        const full = path.join(home(), dir);
        const names = await fs.readdir(full).catch(() => [] as string[]);
        const files = await Promise.all(
          names.map(async (name) => {
            const stat = await fs.stat(path.join(full, name)).catch(() => null);
            return stat?.isFile() ? { name, size: stat.size, modifiedAt: stat.mtimeMs } : null;
          }),
        );
        return files.filter((f) => f !== null);
      },
    },
    secrets: {
      async get(name) {
        const sealed = (await readSecrets())[name];
        return sealed ? requestMain("unseal", { sealed }) : null;
      },
      async set(name, value) {
        const sealed = await requestMain("seal", { text: value });
        await changeSecrets(async (secrets) => {
          secrets[name] = sealed;
          return true;
        });
      },
      delete: (name) =>
        changeSecrets(async (secrets) => {
          if (!(name in secrets)) return false;
          delete secrets[name];
          return true;
        }),
    },
    userFiles: {
      open: (name, bytes) => requestMain("openFile", { name, bytes }),
      save: (name, bytes) => requestMain("saveFile", { name, bytes }),
      pick: () => requestMain("pickFiles", {}),
    },

    google: googleAuth,
    microsoft: microsoftAuth,
    todoistSignIn,
    relayUrl: process.env.OTTER_MAIL_RELAY_URL?.trim() || "https://relay.mail.otterware.app",
    relaySession: "bearer",
    deviceName: backendOS.deviceName(),

    broadcast: broadcastToMain,
    notify: (notification) => tellMain({ _tag: "notify", ...notification }),
    setUnreadCount: (count) => tellMain({ _tag: "badge", count }),
    onResume(listener) {
      resumeListeners.add(listener);
      return () => resumeListeners.delete(listener);
    },
    asyncContext<T>(): AsyncContext<T> {
      const storage = new AsyncLocalStorage<T>();
      return { run: (value, fn) => storage.run(value, fn), get: () => storage.getStore() };
    },
    rawSockets: true,
    crossOriginFetch: true,
    notificationReturn: "desktop",
    syncPolicy: { ...KEEP_MAILBOX, bodyPrefetch: true },
    translator: backendOS.translator,
  };
}
