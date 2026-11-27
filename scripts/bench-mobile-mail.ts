/**
 * Measures Otter Mail for iPhone over the 50,000-message fake Gmail mailbox: builds a simulator
 * Release with `EXPO_PUBLIC_OTTER_MAIL_BENCHMARK=auto`, installs it fresh on an iPhone simulator
 * and launches it. The app scrolls its list through first sync and the 200-change replay that
 * follows, then writes what it measured to its documents, which this prints.
 *
 *   pnpm bench:mobile:mail [--device <name or UDID>] [--prebuild] [--skip-build]
 *
 * --device: the simulator, booted if it isn't (default "Otter Mail Benchmark", an iPhone 18 Pro
 * created on the newest iOS when missing). The app is reinstalled there, so its data is lost.
 * --prebuild: regenerate `ios/` (also done when it's missing). --skip-build: reuse the last build.
 */
import { spawnSync } from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    device: { type: "string", default: "Otter Mail Benchmark" },
    prebuild: { type: "boolean", default: false },
    "skip-build": { type: "boolean", default: false },
    timeout: { type: "string", default: "20" },
  },
});

const project = NodePath.resolve(import.meta.dirname, "../apps/mail-mobile");
const ios = NodePath.join(project, "ios");
const app = NodePath.join(ios, "build/Build/Products/Release-iphonesimulator/OtterMail.app");
const RESULT = "Documents/fake-mail-benchmark/benchmark-result.json";
const GATE = { longest: 50, p95: 16 };

const env: NodeJS.ProcessEnv = {
  ...process.env,
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  EXPO_PUBLIC_OTTER_DATA: "fake",
  EXPO_PUBLIC_OTTER_MAIL_BENCHMARK: "auto",
};
delete env.OTTER_APP_VARIANT;

function run(command: string, args: string[], cwd = project, log?: string): void {
  const out = log ? NodeFS.openSync(log, "w") : "inherit";
  const result = spawnSync(command, args, { cwd, env, stdio: ["ignore", out, out] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed${log ? `: see ${log}` : ""}`);
  }
}

function output(command: string, args: string[]): string {
  const result = spawnSync(command, args, { env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

type Device = { udid: string; name: string; state: string };

const IPHONE = "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro";

function simulator(nameOrId: string): Device & { runtime: string } {
  const list = JSON.parse(output("xcrun", ["simctl", "list", "devices", "available", "-j"])) as {
    devices: Record<string, Device[]>;
  };
  for (const [runtime, devices] of Object.entries(list.devices)) {
    const found = devices.find((d) => d.udid === nameOrId || d.name === nameOrId);
    if (found) return { ...found, runtime };
  }
  const runtimes = JSON.parse(output("xcrun", ["simctl", "list", "runtimes", "-j"])) as {
    runtimes: {
      identifier: string;
      platform: string;
      isAvailable: boolean;
      version: string;
      supportedDeviceTypes: { identifier: string }[];
    }[];
  };
  const runtime = runtimes.runtimes
    .filter(
      (r) =>
        r.platform === "iOS" &&
        r.isAvailable &&
        r.supportedDeviceTypes.some((t) => t.identifier === IPHONE),
    )
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1);
  if (!runtime) throw new Error("No iOS simulator runtime is installed.");
  console.log(`Creating the "${nameOrId}" simulator (iPhone 18 Pro, iOS ${runtime.version})`);
  const udid = output("xcrun", ["simctl", "create", nameOrId, IPHONE, runtime.identifier]);
  return { udid, name: nameOrId, state: "Shutdown", runtime: runtime.identifier };
}

const device = simulator(values.device);
if (device.state !== "Booted") console.log(`Booting ${device.name}`);
output("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);

if (values.prebuild || !NodeFS.existsSync(ios)) {
  run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--clean", "--no-install"]);
  run("pod", ["install"], ios);
}
if (!values["skip-build"]) {
  const log = NodePath.join(ios, "build/benchmark-build.log");
  NodeFS.mkdirSync(NodePath.dirname(log), { recursive: true });
  console.log(
    `Building the simulator Release (EXPO_PUBLIC_OTTER_MAIL_BENCHMARK=auto), log in ${log}`,
  );
  run(
    "xcodebuild",
    [
      "-workspace",
      NodePath.join(ios, "OtterMail.xcworkspace"),
      "-scheme",
      "OtterMail",
      "-configuration",
      "Release",
      "-destination",
      `id=${device.udid}`,
      "-derivedDataPath",
      NodePath.join(ios, "build"),
      // Ad-hoc signing: the Keychain needs a signed app.
      "CODE_SIGN_IDENTITY=-",
      "CODE_SIGN_STYLE=Manual",
      "DEVELOPMENT_TEAM=838JVGY7W4",
      "PROVISIONING_PROFILE_SPECIFIER=",
      "build",
    ],
    project,
    log,
  );
}

const bundleId = output("plutil", [
  "-extract",
  "CFBundleIdentifier",
  "raw",
  NodePath.join(app, "Info.plist"),
]);
spawnSync("xcrun", ["simctl", "terminate", device.udid, bundleId]);
spawnSync("xcrun", ["simctl", "uninstall", device.udid, bundleId]);
run("xcrun", ["simctl", "install", device.udid, app]);
const container = output("xcrun", ["simctl", "get_app_container", device.udid, bundleId, "data"]);
const resultFile = NodePath.join(container, RESULT);
output("xcrun", ["simctl", "launch", device.udid, bundleId]);
console.log(`Launched ${bundleId} on ${device.name}: first sync, then the 200-change replay`);

const started = Date.now();
const deadline = started + Number(values.timeout) * 60_000;
while (!NodeFS.existsSync(resultFile)) {
  if (Date.now() > deadline) {
    throw new Error(`No results after ${values.timeout} minutes (${resultFile}).`);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
spawnSync("xcrun", ["simctl", "terminate", device.udid, bundleId]);

type Blocks = {
  longest: number;
  longestAt: number | null;
  p95: number;
  cpuAtLongest?: number;
  longestCpu: number;
  sqlite?: { operation: string; ms: number; at: number };
};
const result = JSON.parse(NodeFS.readFileSync(resultFile, "utf8")) as {
  firstRowMs: number;
  firstSync: Blocks;
  rowsVisible: Blocks;
  replay?: Blocks & { changes: number; ms: number };
  error?: string;
};

const ms = (n: number) => `${n.toLocaleString("en-US")} ms`;
const passes = (b: Blocks) => b.longest <= GATE.longest && b.p95 <= GATE.p95;
const line = (name: string, b: Blocks, gated: boolean) =>
  `${name.padEnd(22)}${ms(b.longest).padStart(10)}${ms(b.p95).padStart(9)}${(b.cpuAtLongest === undefined ? "" : ms(b.cpuAtLongest)).padStart(10)}${gated ? (passes(b) ? "   pass" : "   FAIL") : ""}`;
const sqlite = (b: Blocks) =>
  b.sqlite ? `${b.sqlite.operation}, ${ms(b.sqlite.ms)}` : "none ≥ 16 ms";

const os = device.runtime.replace(
  /^.*SimRuntime\.(\w+?)-(.*)$/,
  (_, name: string, version: string) => `${name} ${version.replaceAll("-", ".")}`,
);
console.log(`
Otter Mail benchmark · 50,000 fake Gmail messages · Release on ${device.name} (${os})
JavaScript thread, while the list scrolls. Gate: longest block ≤ ${GATE.longest} ms and p95 ≤ ${GATE.p95} ms.

${"".padEnd(22)}${"longest".padStart(10)}${"p95".padStart(9)}${"CPU".padStart(10)}
${line("First sync", result.firstSync, true)}
${line("  while rows showed", result.rowsVisible, false)}
${result.replay ? line(`Replay, ${result.replay.changes} changes`, result.replay, true) : `Replay failed: ${result.error}`}

First row: ${ms(result.firstRowMs)} after launch (informational)
First sync's longest block: ${ms(result.firstSync.longestAt ?? 0)} after launch
Slowest SQLite call, first sync: ${sqlite(result.firstSync)}${result.replay ? `\nSlowest SQLite call, replay: ${sqlite(result.replay)} · replay took ${ms(result.replay.ms)}` : ""}
Gate: ${result.replay && passes(result.firstSync) && passes(result.replay) ? "pass" : "FAIL"}
Results: ${resultFile}`);
