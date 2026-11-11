import type { AppSettings, PickedFile } from "@otter/core";

import type { Level } from "./logger.js";

export type MainRequests = {
  /** safeStorage: `text` encrypted with the Keychain's key, as base64. */
  seal: { params: { text: string }; result: string };
  unseal: { params: { sealed: string }; result: string };
  openExternal: { params: { url: string }; result: void };
  openFile: { params: { name: string; bytes: Uint8Array }; result: void };
  saveFile: { params: { name: string; bytes: Uint8Array }; result: boolean };
  pickFiles: { params: undefined; result: PickedFile[] };
};

export type MainEffect =
  | { kind: "broadcast"; channel: string; params: unknown }
  | {
      kind: "notify";
      title: string;
      subtitle?: string;
      body?: string;
      open?: { accountId: string; messageId: string; mailbox?: string };
      chat?: string;
      code?: string;
    }
  | { kind: "unread"; count: number }
  | { kind: "settings"; settings: AppSettings; patch: Partial<AppSettings> }
  | { kind: "log"; level: Level; scope: string; message: string; data?: string };

export type ToBackend =
  | { type: "invoke"; id: number; channel: string; params: unknown }
  | { type: "reply"; id: number; result?: unknown; error?: string }
  | { type: "resume" }
  | { type: "shutdown" };

export type FromBackend =
  | { type: "ready"; channels: string[] }
  | { type: "result"; id: number; result?: unknown; error?: string }
  | {
      type: "request";
      id: number;
      kind: keyof MainRequests;
      params: MainRequests[keyof MainRequests]["params"];
    }
  | ({ type: "effect" } & MainEffect);

export type AppInfo = {
  stateDir: string;
  version: string;
  packaged: boolean;
  resourcesPath: string;
  errorReports: boolean;
};

const APP_INFO_ENV = "OTTER_APP_INFO";

export const appInfoEnv = (info: AppInfo) => ({ [APP_INFO_ENV]: JSON.stringify(info) });

let info: AppInfo | null = null;

export function appInfo(): AppInfo {
  return (info ??= JSON.parse(process.env[APP_INFO_ENV] ?? "null") as AppInfo);
}
