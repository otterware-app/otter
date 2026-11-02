/**
 * Tests only: core on Node, as far as the IMAP provider needs it: the mail
 * cache in an in-memory node:sqlite database, files and secrets in memory,
 * and real sockets (trusting the test servers' self-signed certificates).
 */

import { DatabaseSync } from "node:sqlite";
import { setPlatform, type Platform, type SqlDatabase } from "../../../platform.ts";
import { nodeConnect } from "../../../protocols/test/node-stream.ts";

const resumeListeners = new Set<() => void>();
let connections = 0;

export function resumeNow(): void {
  for (const listener of resumeListeners) listener();
}

/** Connections opened so far. */
export const connectionCount = () => connections;

export function useNodePlatform(): Platform {
  const files = new Map<string, Uint8Array>();
  const secrets = new Map<string, string>();
  const database = new DatabaseSync(":memory:") as unknown as SqlDatabase;
  const unused = () => {
    throw new Error("Not in tests.");
  };
  const platform: Platform = {
    kind: "desktop",
    appVersion: "test",
    log: (level, scope, message) => {
      if (process.env.DEBUG_IMAP) console.log(`[${level}] ${scope}: ${message}`);
    },
    database: () => database,
    files: {
      read: async (path) => files.get(path) ?? null,
      write: async (path, data) => {
        files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
      },
      remove: async (path) => {
        files.delete(path);
      },
      list: async () => [],
    },
    secrets: {
      get: async (name) => secrets.get(name) ?? null,
      set: async (name, value) => {
        secrets.set(name, value);
      },
      delete: async (name) => {
        secrets.delete(name);
      },
    },
    userFiles: { open: unused, save: unused, pick: unused },
    google: {
      load: async () => {},
      addAccount: unused,
      cancelSignIn: () => {},
      isSignedIn: () => false,
      getAccessToken: unused,
      getIdToken: unused,
      removeTokens: async () => {},
    },
    connect: (...args) => {
      connections++;
      return nodeConnect(...args);
    },
    relayUrl: "http://127.0.0.1:1",
    relaySession: "bearer",
    broadcast: () => {},
    notify: () => {},
    setUnreadCount: () => {},
    onResume: (listener) => {
      resumeListeners.add(listener);
      return () => resumeListeners.delete(listener);
    },
    asyncContext: () => ({ run: (_value, fn) => fn(), get: () => undefined }),
    offlineDownloads: false,
  };
  setPlatform(platform);
  return platform;
}
