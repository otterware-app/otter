import { setupBrowser as setup } from "@otter/browser/main";
import * as path from "node:path";

import { broadcast } from "./ipc.ts";
import { logger } from "./logger.ts";
import { hostOS } from "./os/index.ts";
import { parseMailtoUrl, setPendingMailto } from "./services/mailto-target.ts";
import { editingItems } from "./windows/context-menu.ts";
import { followPageHistoryButtons } from "./windows/history-buttons.ts";
import { getMainWindow } from "./windows/main-window.ts";

export function setupBrowser(): void {
  setup(
    {
      logger,
      broadcast,
      mainWindow: getMainWindow,
      modifierKey: hostOS.modifierKey,
      editingItems,
      followHistoryButtons: followPageHistoryButtons,
      openInApp(url) {
        const mailto = parseMailtoUrl(url);
        if (!mailto) return false;
        setPendingMailto(mailto);
        broadcast("compose:mailto");
        return true;
      },
    },
    path.join(__dirname, "extensions-preload.cjs"),
  );
}
