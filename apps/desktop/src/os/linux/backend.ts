/** Linux's side of the mail backend (BackendOS). No on-device translator. */

import { readFileSync } from "node:fs";
import * as os from "node:os";

import type { BackendOS } from "../types.js";

/** A value from a KEY="value" file such as /etc/os-release. */
function field(file: string, key: string): string | null {
  try {
    const line = readFileSync(file, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).replace(/^"|"$/g, "") || null;
  } catch {
    return null;
  }
}

export const linuxBackend: BackendOS = {
  platform: "linux",
  /** The pretty hostname Settings shows ("Chris's ThinkPad"), else the hostname. */
  deviceName: () => field("/etc/machine-info", "PRETTY_HOSTNAME") ?? os.hostname(),
  environment() {
    const distro = field("/etc/os-release", "PRETTY_NAME") ?? "Linux";
    const session = [process.env.XDG_CURRENT_DESKTOP, process.env.XDG_SESSION_TYPE]
      .filter(Boolean)
      .join(", ");
    return `${distro} (Linux ${os.release()}, ${os.arch()}${session ? `; ${session}` : ""})`;
  },
};
