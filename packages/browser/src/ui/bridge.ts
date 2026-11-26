import type { DesktopBridge } from "@otter/contracts";

/** The app's preload: `window.desktopBridge`. */
export const desktopBridge = () =>
  (globalThis as unknown as { desktopBridge: DesktopBridge }).desktopBridge;
