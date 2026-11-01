/** The Mac's side of the mail backend (BackendOS). */

import { execFileSync } from "node:child_process";
import * as os from "node:os";

import type { BackendOS } from "../types.js";
import { appleTranslator } from "./translator.js";

export const macBackend: BackendOS = {
  platform: "mac",
  /** The Mac's name as the user set it ("Chris's MacBook Pro"). */
  deviceName() {
    try {
      return execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return os.hostname().replace(/\.local$/, "");
    }
  },
  environment: () => `macOS (Darwin ${os.release()}, ${os.arch()})`,
  translator: appleTranslator,
};
