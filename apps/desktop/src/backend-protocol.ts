import type { AppSettings, PickedFile } from "@otter-mail/core";

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
      open?: { accountId: string; messageId: string };
      code?: string;
    }
  /** The Dock badge. */
  | { kind: "unread"; count: number }
  /** Settings main applies itself (open at login, the Dock badge). */
  | { kind: "settings"; settings: AppSettings; patch: Partial<AppSettings> }
  | { kind: "log"; level: Level; scope: string; message: string; data?: string };

export type ToBackend =
  | { type: "invoke"; id: number; channel: string; params: unknown }
  | { type: "reply"; id: number; result?: unknown; error?: string }
  /** The Mac woke up. */
  | { type: "resume" }
  /** The app is quitting: stop the assistants' processes and exit. */
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
};

const APP_INFO_ENV = "OTTER_MAIL_APP_INFO";

export const appInfoEnv = (info: AppInfo) => ({ [APP_INFO_ENV]: JSON.stringify(info) });

let info: AppInfo | null = null;

export function appInfo(): AppInfo {
  return (info ??= JSON.parse(process.env[APP_INFO_ENV] ?? "null") as AppInfo);
}
