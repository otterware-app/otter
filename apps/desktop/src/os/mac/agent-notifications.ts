import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import { logger } from "../../logger.js";
import type { AgentNotifications } from "../types.js";

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
    if (module.exports.supported()) notifier = module.exports;
  } catch (error) {
    logger.error("notify", "the notifier addon failed to load", error);
  }
  return notifier;
}
