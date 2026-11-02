export type NotificationsMode = "off" | "inbox" | "all";

export type AppSettings = {
  syncIntervalSeconds: number;
  notificationsMode: NotificationsMode;
  launchAtLogin: boolean;
  dockBadgeEnabled: boolean;
  /** Languages the user reads (BCP-47 codes, first = where translations go).
      Empty until set: the renderer then falls back to the system languages. */
  readLanguages: string[];
  /** Translate mail in other languages without asking. */
  autoTranslate: boolean;
  errorReports: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  syncIntervalSeconds: 30,
  notificationsMode: "inbox",
  launchAtLogin: false,
  dockBadgeEnabled: false,
  readLanguages: [],
  autoTranslate: false,
  errorReports: true,
};
