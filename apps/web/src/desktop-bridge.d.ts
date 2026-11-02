import type { DesktopBridge } from "@otter-mail/contracts";

declare global {
  const __APP_VERSION__: string;
  const __DEMO__: boolean;
  const __DEV_DEMO__: boolean;
  const __ERROR_REPORTS__: boolean;

  interface Window {
    desktopBridge: DesktopBridge;
  }
}
