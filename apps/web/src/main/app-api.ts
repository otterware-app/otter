import { ipc, task } from "@otter/client/bridge";

export type SettingsPane =
  | "general"
  | "appearance"
  | "keybindings"
  | "accounts"
  | "calendar"
  | "browser"
  | "agents"
  | "integrations"
  | "features"
  | "otter";
export type SettingsTarget = { pane?: SettingsPane; item?: string };

export type MailtoTarget = { to: string; cc: string; subject: string; body: string };

export type MailApp = { id: string; name: string; path: string };
export type MailAppsResult = { apps: MailApp[]; defaultId: string | null };

/** The app's own calls: its windows, Settings, the default mail app, saving a report. */
export const appApi = {
  saveSupportReport: (contents: string, filename?: "Otter diagnostics.json") =>
    task<boolean>("support:saveReport", { contents, filename }),

  openSettings: (target?: SettingsTarget): Promise<void> => ipc("window:openSettings", target),
  closeMainWindow: (): Promise<void> => ipc("window:closeMain"),
  openWindow: (href: string): Promise<void> => ipc("window:open", { href }),

  getSettingsTarget: (): Promise<SettingsTarget | null> => ipc("window:getSettingsTarget"),

  takePendingOpenMessage: (): Promise<{
    accountId: string;
    messageId: string;
    mailbox?: string;
  } | null> => ipc("window:takePendingOpenMessage"),

  takePendingMailto: (): Promise<MailtoTarget | null> => ipc("app:takePendingMailto"),

  getDefaultMailStatus: (): Promise<{ isDefault: boolean }> => ipc("app:getDefaultMailStatus"),

  setDefaultMailApp: (id?: string): Promise<{ ok: boolean }> =>
    ipc("app:setDefaultMailApp", id ? { id } : undefined),

  listMailApps: (): Promise<MailAppsResult> => ipc("app:listMailApps"),
};
