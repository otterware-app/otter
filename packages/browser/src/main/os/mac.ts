import { app } from "electron";
import { execFile } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import * as path from "node:path";
import { promisify } from "node:util";

import type { ChromiumBrowser } from "./index.ts";

const BROWSERS = [
  { id: "chrome", name: "Google Chrome", dir: "Google/Chrome", keychain: "Chrome" },
  { id: "arc", name: "Arc", dir: "Arc/User Data", keychain: "Arc" },
  { id: "brave", name: "Brave", dir: "BraveSoftware/Brave-Browser", keychain: "Brave" },
  { id: "edge", name: "Microsoft Edge", dir: "Microsoft Edge", keychain: "Microsoft Edge" },
  { id: "vivaldi", name: "Vivaldi", dir: "Vivaldi", keychain: "Vivaldi" },
  { id: "chromium", name: "Chromium", dir: "Chromium", keychain: "Chromium" },
];

export function chromiumBrowsers(): ChromiumBrowser[] {
  const support = path.join(app.getPath("home"), "Library/Application Support");
  return BROWSERS.map(({ id, name, dir }) => ({ id, name, dataDir: path.join(support, dir) }));
}

/** macOS asks the user to let Otter read the browser's "Safe Storage" password from the keychain. */
export async function chromiumKeys(browser: ChromiumBrowser): Promise<Record<string, Buffer>> {
  const account = BROWSERS.find((b) => b.id === browser.id)!.keychain;
  const { stdout } = await promisify(execFile)("/usr/bin/security", [
    "find-generic-password",
    "-w",
    "-s",
    `${account} Safe Storage`,
    "-a",
    account,
  ]);
  return { v10: pbkdf2Sync(stdout.trim(), "saltysalt", 1003, 16, "sha1") };
}

export function nativeMessagingDirectories(): string[] {
  const support = path.join(app.getPath("home"), "Library/Application Support");
  return [
    path.join(app.getPath("userData"), "NativeMessagingHosts"),
    path.join(support, "Google/Chrome/NativeMessagingHosts"),
    path.join(support, "Chromium/NativeMessagingHosts"),
    "/Library/Google/Chrome/NativeMessagingHosts",
    "/Library/Application Support/Chromium/NativeMessagingHosts",
  ];
}
