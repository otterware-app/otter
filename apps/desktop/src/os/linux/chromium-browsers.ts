import { app } from "electron";
import { execFile } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import * as path from "node:path";
import { promisify } from "node:util";

import type { ChromiumBrowser } from "../types.ts";

const BROWSERS = [
  { id: "chrome", name: "Google Chrome", dir: "google-chrome", secret: "chrome" },
  { id: "brave", name: "Brave", dir: "BraveSoftware/Brave-Browser", secret: "brave" },
  { id: "chromium", name: "Chromium", dir: "chromium", secret: "chromium" },
];

export function chromiumBrowsers(): ChromiumBrowser[] {
  const config = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config");
  return BROWSERS.map(({ id, name, dir }) => ({ id, name, dataDir: path.join(config, dir) }));
}

const key = (password: string) => pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");

/** "v10" is Chromium's fixed password; "v11" its password in the desktop's keyring, when there is one. */
export async function chromiumKeys(browser: ChromiumBrowser): Promise<Record<string, Buffer>> {
  const application = BROWSERS.find((b) => b.id === browser.id)!.secret;
  const keys: Record<string, Buffer> = { v10: key("peanuts") };
  try {
    const { stdout } = await promisify(execFile)("secret-tool", [
      "lookup",
      "application",
      application,
    ]);
    if (stdout.trim()) keys.v11 = key(stdout.trim());
  } catch {
    // No keyring, or no secret-tool: only what Chromium encrypted without one can be read.
  }
  return keys;
}
