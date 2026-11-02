// Keep the executable named Electron so app.isPackaged stays false after rebranding.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
export const desktopDir = NodePath.resolve(__dirname, "..");

const APP_DISPLAY_NAME = "Otter Mail (Dev)";
const APP_BUNDLE_ID = "dev.otterware.mail.dev";
// Bump when the patching below changes, to force a fresh copy.
const LAUNCHER_VERSION = 1;
const iconPath = NodePath.join(desktopDir, "resources", "icon-dev.icns");
const runtimeDir = NodePath.join(desktopDir, ".electron-runtime");

const require = NodeModule.createRequire(import.meta.url);

function run(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${details ? `:\n${details}` : ""}`);
  }
}

function setPlistValue(plistPath, key, type, value) {
  const replaced = NodeChildProcess.spawnSync("plutil", ["-replace", key, type, value, plistPath]);
  if (replaced.status === 0) return;
  run("plutil", ["-insert", key, type, value, plistPath]);
}

function readJson(filePath) {
  try {
    return JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function resolveElectronBinaryPath() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch (error) {
    throw new Error(
      `Could not resolve the electron package from ${desktopDir}. Run \`pnpm install\` first.`,
      { cause: error },
    );
  }
  if (typeof electronPath !== "string" || !NodeFS.existsSync(electronPath)) {
    throw new Error(
      "The Electron binary is missing. Reinstall it with `pnpm install --force` " +
        "(or `node apps/desktop/node_modules/electron/install.js`).",
    );
  }
  return electronPath;
}

function patchHelperBundles(appBundlePath) {
  const helpers = [
    ["Electron Helper.app", "helper", "Helper"],
    ["Electron Helper (GPU).app", "helper.gpu", "Helper (GPU)"],
    ["Electron Helper (Plugin).app", "helper.plugin", "Helper (Plugin)"],
    ["Electron Helper (Renderer).app", "helper.renderer", "Helper (Renderer)"],
  ];
  for (const [bundleName, idSuffix, nameSuffix] of helpers) {
    const plist = NodePath.join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(plist)) continue;
    setPlistValue(plist, "CFBundleName", "-string", `${APP_DISPLAY_NAME} ${nameSuffix}`);
    setPlistValue(plist, "CFBundleDisplayName", "-string", `${APP_DISPLAY_NAME} ${nameSuffix}`);
    setPlistValue(plist, "CFBundleIdentifier", "-string", `${APP_BUNDLE_ID}.${idSuffix}`);
  }
}

function registerDevUrlScheme(appBundlePath) {
  run(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", appBundlePath],
  );
  // Make the dev bundle own ottermail-dev:// links. mailto stays the user's
  // choice (Settings > Default mail app), so it is never claimed here.
  const result = NodeChildProcess.spawnSync(
    "osascript",
    [
      "-l",
      "JavaScript",
      "-e",
      [
        'ObjC.import("CoreServices");',
        '$.LSSetDefaultHandlerForURLScheme($("ottermail-dev"), $(' +
          JSON.stringify(APP_BUNDLE_ID) +
          "));",
      ].join(" "),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.warn(`[electron-launcher] Could not claim ottermail-dev:// (${result.stderr.trim()})`);
  }
}

function ensureMacDevBundle(electronBinaryPath) {
  const sourceBundle = NodePath.resolve(NodePath.dirname(electronBinaryPath), "..", "..");
  const targetBundle = NodePath.join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinary = NodePath.join(targetBundle, "Contents", "MacOS", "Electron");
  const metadataPath = NodePath.join(runtimeDir, "metadata.json");
  const electronVersion = readJson(require.resolve("electron/package.json"))?.version;
  const expected = {
    launcherVersion: LAUNCHER_VERSION,
    electronVersion,
    iconMtimeMs: NodeFS.existsSync(iconPath) ? NodeFS.statSync(iconPath).mtimeMs : 0,
  };

  if (
    NodeFS.existsSync(targetBinary) &&
    JSON.stringify(readJson(metadataPath)) === JSON.stringify(expected)
  ) {
    return targetBinary;
  }

  console.log(
    `[electron-launcher] Preparing ${APP_DISPLAY_NAME}.app (Electron ${electronVersion})`,
  );
  NodeFS.mkdirSync(runtimeDir, { recursive: true });
  NodeFS.rmSync(targetBundle, { recursive: true, force: true });
  // verbatimSymlinks keeps the framework's relative symlinks relative, so the
  // copy does not point back into node_modules.
  NodeFS.cpSync(sourceBundle, targetBundle, { recursive: true, verbatimSymlinks: true });

  const plist = NodePath.join(targetBundle, "Contents", "Info.plist");
  setPlistValue(plist, "CFBundleName", "-string", APP_DISPLAY_NAME);
  setPlistValue(plist, "CFBundleDisplayName", "-string", APP_DISPLAY_NAME);
  setPlistValue(plist, "CFBundleIdentifier", "-string", APP_BUNDLE_ID);
  setPlistValue(plist, "CFBundleIconFile", "-string", "icon.icns");
  setPlistValue(
    plist,
    "CFBundleURLTypes",
    "-json",
    JSON.stringify([
      { CFBundleURLName: "Email", CFBundleURLSchemes: ["mailto"] },
      { CFBundleURLName: APP_BUNDLE_ID, CFBundleURLSchemes: ["ottermail-dev"] },
    ]),
  );
  if (NodeFS.existsSync(iconPath)) {
    const resources = NodePath.join(targetBundle, "Contents", "Resources");
    NodeFS.copyFileSync(iconPath, NodePath.join(resources, "icon.icns"));
    NodeFS.copyFileSync(iconPath, NodePath.join(resources, "electron.icns"));
  }
  patchHelperBundles(targetBundle);
  // Editing Info.plist breaks Electron's signature; re-seal it ad hoc so
  // macOS keeps launching it and notifications work.
  run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", targetBundle]);
  registerDevUrlScheme(targetBundle);

  NodeFS.writeFileSync(metadataPath, `${JSON.stringify(expected, null, 2)}\n`);
  return targetBinary;
}

export function resolveElectronPath() {
  const electronBinaryPath = resolveElectronBinaryPath();
  if (process.platform !== "darwin") return electronBinaryPath;
  try {
    return ensureMacDevBundle(electronBinaryPath);
  } catch (error) {
    console.warn(
      `[electron-launcher] Falling back to the stock Electron.app: ${error instanceof Error ? error.message : String(error)}`,
    );
    return electronBinaryPath;
  }
}

/** Environment for the Electron child: never inherit ELECTRON_RUN_AS_NODE. */
export function electronChildEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
