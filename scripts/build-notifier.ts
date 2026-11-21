#!/usr/bin/env node
// Builds native/notifier, the Node-API addon that posts communication notifications (macOS).
// Prints the path of the built addon on the last line of stdout.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { repoRoot } from "./build-translator.ts";

const packageDir = NodePath.join(repoRoot, "native", "notifier");
export const notifierAddonPath = NodePath.join(packageDir, ".build", "notifier.node");

export function buildNotifier(): string {
  const headers = NodePath.resolve(process.execPath, "..", "..", "include", "node");
  if (!NodeFS.existsSync(NodePath.join(headers, "node_api.h"))) {
    throw new Error(`Node-API headers not found in ${headers}.`);
  }
  NodeFS.mkdirSync(NodePath.dirname(notifierAddonPath), { recursive: true });
  const args = [
    "clang",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-arch",
    "arm64",
    "-mmacosx-version-min=12.0",
    "-O2",
    "-fobjc-arc",
    "-Wall",
    "-DNAPI_VERSION=8",
    `-I${headers}`,
    "-framework",
    "Foundation",
    "-framework",
    "Intents",
    "-framework",
    "Security",
    "-framework",
    "UserNotifications",
    NodePath.join(packageDir, "notifier.m"),
    "-o",
    notifierAddonPath,
  ];
  const result = NodeChildProcess.spawnSync("xcrun", args, { stdio: "inherit" });
  if (result.error) throw new Error(`Could not run clang: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`clang failed with exit code ${result.status}.`);
  return notifierAddonPath;
}

if (import.meta.main) {
  try {
    console.log(buildNotifier());
  } catch (error) {
    console.error(`[build-notifier] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
