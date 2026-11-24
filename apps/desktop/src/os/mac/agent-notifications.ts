import { app, Notification } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import { logger } from "../../logger.ts";
import type { AgentNotifications } from "../types.ts";

function addonPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", "notifier.node");
  return path.resolve(__dirname, "..", "..", "..", "native", "notifier", ".build", "notifier.node");
}

let notifier: AgentNotifications | null | undefined;

/** native/notifier, when this build is entitled to communication notifications. */
export function agentNotifications(): AgentNotifications | null {
  if (notifier !== undefined) return notifier;
  notifier = null;
  const file = addonPath();
  if (!existsSync(file)) return null;
  try {
    const module = { exports: {} as AgentNotifications & { supported(): boolean } };
    process.dlopen(module, file);
    if (!module.exports.supported()) return null;
    // Electron makes itself the notification center's delegate once, as this creates its presenter:
    // the addon wraps that delegate when it posts, so it must already be there.
    Notification.isSupported();
    notifier = module.exports;
  } catch (error) {
    logger.error("notify", "the notifier addon failed to load", error);
  }
  return notifier;
}
