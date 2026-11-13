#!/usr/bin/env node
// Builds an iPhone app for the simulator and runs it in the booted one (booting an iPhone first
// if none is): Otter Mail (apps/ios), or Otter Agents (apps/ios-agents) with `--app agents`.
// Use `--relay local` to point it at this checkout's `pnpm dev` relay instead of production, and
// `--as <email>` with `pnpm dev:demo`'s relay to sign in as that Otter account without Google.
//
//   pnpm dev:ios [--relay local]
//   pnpm dev:ios:agents [--relay local [--as <email>]]

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { BASE_RELAY_PORT, resolvePortOffset } from "./port-offset.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const agents = process.argv.includes("agents");
const target = agents
  ? {
      folder: "apps/ios-agents",
      project: "OtterAgents.xcodeproj",
      scheme: "OtterAgents",
      product: "Otter Agents.app",
      bundle: "dev.otterware.agents.dev",
    }
  : {
      folder: "apps/ios",
      project: "OtterMail.xcodeproj",
      scheme: "OtterMail",
      product: "Otter Mail.app",
      bundle: "dev.otterware.mail.dev",
    };
const derived = NodePath.join(root, target.folder, ".build");
const app = NodePath.join(derived, "Build/Products/Debug-iphonesimulator", target.product);
const local = process.argv.includes("local");
const as = process.argv.includes("--as")
  ? process.argv[process.argv.indexOf("--as") + 1]
  : undefined;
const relayPort = BASE_RELAY_PORT + resolvePortOffset(process.env, root).offset;

const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) =>
  NodeChildProcess.execFileSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
const read = (command: string, args: string[]) =>
  NodeChildProcess.execFileSync(command, args, { encoding: "utf8" });

run("node", [NodePath.join(root, "scripts/export-ios-resources.ts")]);

const devices = JSON.parse(read("xcrun", ["simctl", "list", "devices", "available", "--json"])) as {
  devices: Record<string, { udid: string; name: string; state: string }[]>;
};
const iphones = Object.values(devices.devices)
  .flat()
  .filter((d) => d.name.startsWith("iPhone"));
const device = iphones.find((d) => d.state === "Booted") ?? iphones.at(-1);
if (!device)
  throw new Error("No iPhone simulator. Add one in Xcode › Window › Devices and Simulators.");
if (device.state !== "Booted") run("xcrun", ["simctl", "boot", device.udid]);
try {
  run("open", ["-a", "Simulator"]);
} catch {
  // No Simulator window (a headless session, or T3's Device panel is showing it).
}

run("xcodebuild", [
  "-project",
  NodePath.join(root, target.folder, target.project),
  "-scheme",
  target.scheme,
  "-destination",
  `platform=iOS Simulator,id=${device.udid}`,
  "-derivedDataPath",
  derived,
  "-quiet",
  "build",
]);
run("xcrun", ["simctl", "install", device.udid, app]);
run(
  "xcrun",
  ["simctl", "launch", "--terminate-running-process", device.udid, target.bundle],
  local
    ? {
        SIMCTL_CHILD_OTTER_RELAY_URL: `http://localhost:${relayPort}`,
        ...(as ? { SIMCTL_CHILD_OTTER_DEV_EMAIL: as } : {}),
      }
    : {},
);
