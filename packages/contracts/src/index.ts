export * from "./connections.ts";
export * from "./google.ts";
export * from "./mail.ts";
export * from "./meetings.ts";
export * from "./microsoft.ts";
export * from "./settings.ts";

export type ThemeSource = "system" | "light" | "dark";

export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: ThemeSource;
  shouldUseHighContrastColors: boolean;
  prefersReducedTransparency: boolean;
}

export type UpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export type UpdateChannel = "stable" | "nightly";

export interface UpdateState {
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  checkedAt: number | null;
  message: string | null;
  /**
   * Set when an update can't install itself (macOS refusing a build without a
   * Developer ID signature): the release page to install it from by hand.
   */
  manualDownloadUrl: string | null;
}

export interface BridgeFeatures {
  windowControls: "left" | "right" | null;
  historyButtons: boolean;
  /**
   * Two-finger trackpad swipes go back and forward. Only on a Mac: elsewhere a
   * mouse's tilt wheel scrolls just as a trackpad swipe does.
   */
  swipeNavigation: boolean;
  launchAtLogin: boolean;
  dockBadge: boolean;
  defaultMailApp: boolean;
  translation: boolean;
  dragOut: boolean;
  openFiles: boolean;
  externalAgent: boolean;
  localAgents: boolean;
  /**
   * The browser in the agent panel: links from mail and chat open there as
   * tabs, with Chrome Web Store extensions (a web page can't embed sites).
   */
  browser: boolean;
  /** Calls and texts to a phone number in a message (tel:, sms:): FaceTime and Messages. */
  phoneCalls: boolean;
}

export interface DesktopBridge {
  platform: "darwin" | "linux" | "win32" | "web" | "ios" | (string & {});
  features: BridgeFeatures;
  invoke<T = unknown>(channel: string, params?: unknown): Promise<T>;
  on(channel: string, listener: (params: unknown) => void): () => void;
  openExternal(url: string): Promise<void>;
  /** The region set on the computer (DE, US), which can differ from its language's. */
  region(): Promise<string | undefined>;
  nativeTheme: {
    getInfo(): Promise<NativeThemeInfo>;
    setThemeSource(source: ThemeSource): Promise<void>;
  };
  updates: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    setChannel(channel: UpdateChannel): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
    onState(listener: (state: UpdateState) => void): () => void;
  };
}

export const UPDATE_STATE_CHANNEL = "updates:state";

export interface OtterAccountState {
  user: { email: string; name: string | null; picture: string | null } | null;
  realtime: "off" | "connecting" | "live";
}

export interface OtterDevice {
  token: string;
  name: string;
  current: boolean;
  lastActiveAt: number;
}

export const OTTER_ACCOUNT_STATE_CHANNEL = "otter:state";

export const GMAIL_SETTINGS_PERMISSION =
  "Otter needs permission to change this account's Gmail settings. Sign in to it again to allow it.";

export type ChatChange = {
  title: string;
  action: "created" | "updated" | "deleted" | "trashed" | "restored";
  target:
    | { kind: "draft"; id: string; accountId: string }
    | { kind: "thread"; id: string; accountId: string }
    | { kind: "label"; id: string; accountId: string }
    | { kind: "view"; id: string }
    | { kind: "theme"; id: string }
    | { kind: "event"; id: string; accountId: string; url: string | null };
};
