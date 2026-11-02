/**
 * electron-builder's afterSign hook for signed Mac builds: notarizes the app
 * with notarytool (APPLE_API_KEY, the .p8's path; APPLE_API_KEY_ID;
 * APPLE_API_ISSUER), then staples the ticket. electron-builder's own
 * `notarize: true` fails the release when stapling can't reach Apple's ticket
 * server (CloudKit) from the runner, though the app is already notarized; this
 * retries, and if the server stays out of reach ships it unstapled (macOS then
 * fetches the ticket online on first open).
 */

import { execFileSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type AfterSignContext = {
  appOutDir: string;
  electronPlatformName: string;
  packager: { appInfo: { productFilename: string } };
};

const STAPLE_ATTEMPTS = 5;

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function log(message: string): void {
  console.log(`[notarize] ${message}`);
}

function notarize(appPath: string): void {
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    throw new Error("Notarizing needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.");
  }
  const auth = ["--key", APPLE_API_KEY, "--key-id", APPLE_API_KEY_ID, "--issuer", APPLE_API_ISSUER];
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-notarize-"));
  try {
    const zipPath = NodePath.join(tempDir, `${NodePath.basename(appPath, ".app")}.zip`);
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath]);
    log(`Submitting ${NodePath.basename(appPath)} to Apple…`);
    const result = JSON.parse(
      run("xcrun", ["notarytool", "submit", zipPath, ...auth, "--wait", "--output-format", "json"]),
    ) as { id: string; status: string };
    if (result.status !== "Accepted") {
      const details = run("xcrun", ["notarytool", "log", result.id, ...auth]);
      throw new Error(`Notarization ${result.status} (${result.id}):\n${details}`);
    }
    log(`Notarized (${result.id}).`);
  } finally {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function staple(appPath: string): Promise<void> {
  for (let attempt = 1; attempt <= STAPLE_ATTEMPTS; attempt++) {
    try {
      run("xcrun", ["stapler", "staple", appPath]);
      log("Stapled.");
      return;
    } catch (error) {
      const output = (error as { stdout?: string }).stdout?.trim().split("\n").at(-1) ?? "";
      log(`Stapling failed (attempt ${attempt} of ${STAPLE_ATTEMPTS}): ${output}`);
      if (attempt < STAPLE_ATTEMPTS) await sleep(attempt * 30_000);
    }
  }
  console.log(
    "::warning::Couldn't staple the notarization ticket (Apple's ticket server was out of reach); shipping it unstapled.",
  );
}

export default async function afterSign(context: AfterSignContext): Promise<void> {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = NodePath.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  notarize(appPath);
  await staple(appPath);
}
