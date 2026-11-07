#!/usr/bin/env node
// The Expo iPhone app (apps/mobile) in Debug on the simulator, from Metro with
// Fast Refresh: the UI runtime and core's worker runtime both load Metro's
// bundle, so JS changes reload without a native build. The first run (or
// `--build`, after native changes) prebuilds and builds the app.
//
//   pnpm dev:mobile [--fake] [--relay local] [--build] [--port 8081] [--device <udid>]
//
// --fake: apps/web's made-up mailbox (no Google or Otter account).
// --relay local: `pnpm dev`'s relay on :8787.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const root = NodePath.resolve(import.meta.dirname, "..");
const mobile = NodePath.join(root, "apps/mobile");
const { values } = NodeUtil.parseArgs({
  options: {
    fake: { type: "boolean", default: false },
    relay: { type: "string" },
    build: { type: "boolean", default: false },
    port: { type: "string", default: "8081" },
    device: { type: "string" },
  },
});

const env: NodeJS.ProcessEnv = {
  ...process.env,
  APP_VARIANT: "development",
  EXPO_NO_GIT_STATUS: "1",
  ...(values.fake ? { EXPO_PUBLIC_OTTER_MAIL_FAKE_MAILBOX: "1" } : {}),
  ...(values.relay === "local"
    ? { EXPO_PUBLIC_OTTER_MAIL_RELAY_URL: "http://localhost:8787" }
    : {}),
};
const run = (args: string[]) =>
  NodeChildProcess.execFileSync("npx", args, { cwd: mobile, stdio: "inherit", env });

const device = values.device ? ["--device", values.device] : [];
if (values.build || !NodeFS.existsSync(NodePath.join(mobile, "ios"))) {
  run(["expo", "prebuild", "--clean", "--platform", "ios"]);
  // Builds Debug, installs, launches, and stays up as its Metro.
  run(["expo", "run:ios", "--configuration", "Debug", "--port", values.port, ...device]);
} else {
  console.log(
    "Metro for the installed Debug build. Open Otter Mail Dev on the simulator (or press r here to reload).",
  );
  run(["expo", "start", "--port", values.port]);
}
