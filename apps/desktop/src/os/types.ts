import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
} from "electron";

import type { Translator } from "@otter/core";

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

  /** Whether this launch was the login item's: the app then starts in the background. */
  launchedAtLogin(): boolean;
  /** What brings the window back once it is closed, where the OS has no Dock for that. */
  showInTray(open: () => void): void;

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

  /** Agents' notifications with the agent's picture in place of the app's, where the build can. */
  agentNotifications?(): AgentNotifications | null;
}

export interface AgentNotifications {
  post(notice: {
    id: string;
    chat: string;
    /** The chat's name, shown as the conversation the message is in. */
    conversation?: string;
    body?: string;
    sound?: string;
    silent?: boolean;
    actions?: string[];
    reply?: string;
    /** For a sender without a picture: its `emoji`, else its kind's `mark` (SVG), else its initial. */
    sender: { id: string; name: string; image?: Buffer; emoji?: string; mark?: string };
  }): Promise<void>;
  remove(ids: string[]): void;
  /** A click (neither `action` nor `reply`), a button (its index) or a reply. */
  onResponse(
    listener: (response: { id: string; chat: string; action?: number; reply?: string }) => void,
  ): void;
}

export interface BackendOS {
  platform: "mac" | "linux";
  deviceName(): string;
  environment(): string;
  translator?: Translator;
}
