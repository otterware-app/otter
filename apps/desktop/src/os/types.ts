/**
 * What differs between the operating systems the desktop app runs on (macOS
 * and Linux), as one interface each implements: os/mac and os/linux. The rest
 * of the app asks `hostOS` (os/index.ts) and never checks `process.platform`
 * itself. What the renderer may show follows from os/features.ts.
 */

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
} from "electron";

import type { Translator } from "@otter-mail/core";

export type MailApp = { id: string; name: string; path: string };
export type MailApps = { apps: MailApp[]; defaultId: string | null };

export type TerminalApp = { id: string; name: string };

export type AppMenuItems = {
  about: MenuItemConstructorOptions;
  checkForUpdates: MenuItemConstructorOptions;
  settings: MenuItemConstructorOptions;
  file: MenuItemConstructorOptions[];
  edit: MenuItemConstructorOptions[];
  view: MenuItemConstructorOptions[];
  go: MenuItemConstructorOptions[];
  mailbox: MenuItemConstructorOptions[];
  help: MenuItemConstructorOptions[];
};

export interface HostOS {
  nativeMessagingDirectories(): string[];

  modifierKey: "metaKey" | "ctrlKey";

  mainWindowOptions(): BrowserWindowConstructorOptions;
  windowFollowsTheme(win: BrowserWindow): void;
  applicationMenu(items: AppMenuItems): MenuItemConstructorOptions[];

  runsWithoutWindows: boolean;

  /**
   * Whether a downloaded update installs whenever the app quits, or only on
   * "Restart to update" (a .deb asks for the admin password: not at logout).
   */
  installsUpdatesOnQuit: boolean;

  prepareSecrets(): void;

  setLaunchAtLogin(enabled: boolean): void;
  setBadge(count: number): void;

  mailApps: {
    list(): Promise<MailApps>;
    setDefault(id: string): Promise<void>;
  };

  terminals: {
    list(): Promise<{ apps: TerminalApp[]; defaultName: string | null }>;
    open(launcher: string, terminalId: string | null): Promise<void>;
    launcher: { fileName: string; shebang: string };
  };
}

export interface BackendOS {
  platform: "mac" | "linux";
  deviceName(): string;
  environment(): string;
  translator?: Translator;
}
