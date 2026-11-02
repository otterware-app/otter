#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

import { buildTranslator, findTranslatorBinary, repoRoot } from "./build-translator.ts";
import { SENTRY_PROJECTS, uploadSourcemaps } from "./upload-sourcemaps.ts";
import { isNightlyVersion } from "../packages/shared/src/release-channel.ts";

const APP_ID = "dev.otterware.mail";
const PRODUCT_NAME = "Otter Mail";
const LINUX_NAME = "otter-mail";
const MAINTAINER = "Christophe Kafrouni <chris.kafrouni@gmail.com>";
const DEFAULT_UPDATE_REPOSITORY = "otterware-app/otter-mail";

const desktopDir = NodePath.join(repoRoot, "apps", "desktop");
const webDir = NodePath.join(repoRoot, "apps", "web");
const vpBin = NodePath.join(repoRoot, "node_modules", ".bin", "vp");
const electronBuilderBin = NodePath.join(desktopDir, "node_modules", ".bin", "electron-builder");
const NOTARIZE_HOOK = NodePath.join(repoRoot, "scripts", "notarize-mac.ts");

const HELP = `Usage: node scripts/build-desktop-artifact.ts [options]

Options:
  --platform mac|linux      Target platform. Default: mac. Build each on its own OS.
  --target dmg|zip|deb      Installer target. mac: dmg (default) or zip; a zip is
                            always built too (auto-update needs it). linux: deb.
  --arch arm64|x64          Target architecture. mac: arm64 (Apple Silicon only).
                            linux: x64 (default) or arm64.
  --build-version <v>       App version. Default: apps/desktop/package.json version.
  --output-dir <dir>        Where artifacts are copied. Default: release/.
  --skip-build              Reuse existing apps/web/dist, apps/desktop/dist-electron
                            and translator builds.
  --keep-stage              Keep the temporary staging directory.
  --signed                  macOS: sign with Developer ID (CSC_LINK and CSC_KEY_PASSWORD, or
                            CSC_NAME for an identity in the keychain) and
                            notarize (APPLE_API_KEY, APPLE_API_KEY_ID,
                            APPLE_API_ISSUER). Unsigned builds are ad hoc.
  --verbose                 Print electron-builder debug output.
  -h, --help                Show this help.

Environment:
  OTTER_MAIL_UPDATE_REPOSITORY  owner/repo for the GitHub update feed
                                (falls back to GITHUB_REPOSITORY, then
                                ${DEFAULT_UPDATE_REPOSITORY}).
  OTTER_MAIL_UPDATE_URL         Update feed URL instead of GitHub Releases, for
                                testing the updater against a local server.
`;

interface Options {
  readonly platform: "mac" | "linux";
  readonly target: string;
  readonly arch: "arm64" | "x64";
  readonly version: string;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
}

function readJson<T>(path: string): T {
  return JSON.parse(NodeFS.readFileSync(path, "utf8")) as T;
}

function log(message: string): void {
  console.log(`[desktop-artifact] ${message}`);
}

function fail(message: string): never {
  console.error(`[desktop-artifact] ${message}`);
  process.exit(1);
}

export function parseOptions(argv: readonly string[]): Options | null {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      platform: { type: "string", default: "mac" },
      target: { type: "string" },
      arch: { type: "string" },
      "build-version": { type: "string" },
      "output-dir": { type: "string", default: "release" },
      "skip-build": { type: "boolean", default: false },
      "keep-stage": { type: "boolean", default: false },
      signed: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return null;

  const platform = values.platform;
  if (platform !== "mac" && platform !== "linux") {
    throw new Error(`Unsupported --platform "${platform}". Use "mac" or "linux".`);
  }
  const target = values.target ?? (platform === "mac" ? "dmg" : "deb");
  const arch = values.arch ?? (platform === "mac" ? "arm64" : "x64");
  if (platform === "mac") {
    if (target !== "dmg" && target !== "zip") {
      throw new Error(`Unsupported --target "${target}" for mac. Use "dmg" (or "zip").`);
    }
    if (arch !== "arm64") {
      throw new Error(
        `Unsupported --arch "${arch}" for mac. Only Apple Silicon (arm64) is supported.`,
      );
    }
  } else {
    if (target !== "deb") throw new Error(`Unsupported --target "${target}" for linux. Use "deb".`);
    if (arch !== "x64" && arch !== "arm64") {
      throw new Error(`Unsupported --arch "${arch}" for linux. Use "x64" or "arm64".`);
    }
    if (values.signed) throw new Error("--signed is for macOS builds.");
  }
  const version =
    values["build-version"]?.trim().replace(/^v/, "") ||
    readJson<{ version: string }>(NodePath.join(desktopDir, "package.json")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid --build-version "${version}". Expected semver like 1.2.3.`);
  }

  return {
    platform,
    target,
    arch,
    version,
    outputDir: NodePath.resolve(repoRoot, values["output-dir"]),
    skipBuild: values["skip-build"],
    keepStage: values["keep-stage"],
    signed: values.signed,
    verbose: values.verbose,
  };
}

export function resolvePublishConfig(version: string, env: NodeJS.ProcessEnv) {
  const nightly = isNightlyVersion(version);
  if (version.includes("-") && !nightly) return undefined;
  // Testing the updater against a local feed (a folder of release artifacts
  // served over http) instead of GitHub Releases.
  const url = env.OTTER_MAIL_UPDATE_URL?.trim();
  if (url) return { provider: "generic", url, channel: nightly ? "nightly" : "latest" };
  const repository =
    env.OTTER_MAIL_UPDATE_REPOSITORY?.trim() ||
    env.GITHUB_REPOSITORY?.trim() ||
    DEFAULT_UPDATE_REPOSITORY;
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`Update repository must look like owner/repo; received "${repository}".`);
  }
  return {
    provider: "github",
    owner,
    repo,
    releaseType: nightly ? "prerelease" : "release",
    channel: nightly ? "nightly" : "latest",
  };
}

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
`;

/**
 * On Linux the product name is the install directory (/opt/otter-mail): a
 * space there breaks xdg-utils, which reads the .desktop file's Exec line
 * (xdg-mime, xdg-open) and would take the app for missing. People still see
 * "Otter Mail": the .desktop entry's Name, and the app names itself (paths.ts).
 */
const productName = (platform: "mac" | "linux") => (platform === "mac" ? PRODUCT_NAME : LINUX_NAME);

export function createBuildConfig(options: {
  platform: "mac" | "linux";
  version: string;
  target: string;
  signed: boolean;
  electronVersion: string;
  entitlementsPath: string | undefined;
  env: NodeJS.ProcessEnv;
}): Record<string, unknown> {
  const publish = resolvePublishConfig(options.version, options.env);
  const icon = isNightlyVersion(options.version) ? "icon-nightly" : "icon";
  const config: Record<string, unknown> = {
    appId: APP_ID,
    productName: productName(options.platform),
    electronVersion: options.electronVersion,
    artifactName: "Otter-Mail-${version}-${arch}.${ext}",
    electronLanguages: ["en-US"],
    npmRebuild: false,
    nodeGypRebuild: false,
    files: ["package.json", "dist-electron/**/*", "renderer/**/*", "!**/*.map"],
    directories: { buildResources: "resources", output: "dist" },
    extraResources: [{ from: `resources/${icon}.png`, to: `${icon}.png` }],
    generateUpdatesFilesForAllChannels: false,
    protocols: [
      { name: "Email", schemes: ["mailto"] },
      { name: PRODUCT_NAME, schemes: ["ottermail"] },
    ],
    mac: {
      extraResources: [{ from: "bin/translator", to: "bin/translator" }],
      target: options.target === "dmg" ? ["dmg", "zip"] : ["zip"],
      category: "public.app-category.productivity",
      icon: `${icon}.icns`,
      darkModeSupport: true,
      hardenedRuntime: true,
      extendInfo: {
        LSApplicationCategoryType: "public.app-category.productivity",
        NSUserNotificationAlertStyle: "banner",
      },
      ...(options.signed
        ? {
            entitlements: options.entitlementsPath,
            entitlementsInherit: options.entitlementsPath,
            notarize: false,
          }
        : {
            // No Developer ID: seal the bundle ad hoc ("-"). Skipping signing
            // (identity: null) would leave Electron's stale signature after
            // electron-builder edits the bundle, which macOS reports as
            // "damaged". Hardened runtime needs a real identity.
            identity: "-",
            hardenedRuntime: false,
            notarize: false,
          }),
    },
    linux: {
      target: ["deb"],
      executableName: LINUX_NAME,
      icon: `${icon}.png`,
      category: "Network;Email;Office",
      synopsis: "Gmail, calm and fast.",
      maintainer: MAINTAINER,
      vendor: "Otterware",
      syncDesktopName: true,
      desktop: {
        entry: {
          Name: PRODUCT_NAME,
          Keywords: "mail;email;gmail;imap;",
        },
      },
    },
    deb: {
      packageName: LINUX_NAME,
      depends: [
        "libgtk-3-0",
        "libnotify4",
        "libnss3",
        "libxss1",
        "libxtst6",
        "xdg-utils",
        "libatspi2.0-0",
        "libuuid1",
        "libsecret-1-0",
      ],
    },
    dmg: {
      title: `${PRODUCT_NAME} ${options.version}`,
      window: { width: 540, height: 380 },
      iconSize: 100,
      contents: [
        { x: 140, y: 190, type: "file" },
        { x: 400, y: 190, type: "link", path: "/Applications" },
      ],
    },
  };
  if (options.platform === "mac" && options.signed) config.afterSign = NOTARIZE_HOOK;
  if (publish) config.publish = [publish];
  return config;
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; label?: string } = {},
): void {
  const label = options.label ?? [command, ...args].join(" ");
  log(`$ ${label}`);
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}.`);
}

function copyDir(from: string, to: string, filter?: (path: string) => boolean): void {
  NodeFS.cpSync(from, to, {
    recursive: true,
    ...(filter ? { filter: (source: string) => filter(source) } : {}),
  });
}

function binaryArchs(path: string): string[] {
  const result = NodeChildProcess.spawnSync("lipo", ["-archs", path], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\s+/) : [];
}

function resolveTranslatorBinary(options: Options): string {
  let binary: string | undefined;
  if (options.skipBuild) {
    binary = findTranslatorBinary();
    if (!binary) {
      fail("No translator build found. Run `pnpm build:translator` or drop --skip-build.");
    }
  } else {
    log("Building native/translator (arm64)...");
    try {
      binary = buildTranslator();
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  const present = binaryArchs(binary);
  if (present.length !== 1 || present[0] !== "arm64") {
    fail(
      `${binary} must be arm64 only (has ${present.join(", ") || "none"}). ` +
        "Run `pnpm build:translator`.",
    );
  }
  return binary;
}

function main(): void {
  let options: Options | null;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!options) {
    console.log(HELP);
    return;
  }
  const mac = options.platform === "mac";
  if (mac && process.platform !== "darwin") fail("macOS artifacts must be built on macOS.");
  if (!mac && process.platform !== "linux") fail("Linux artifacts must be built on Linux.");

  const electronVersion = readJson<{ version: string }>(
    NodePath.join(desktopDir, "node_modules", "electron", "package.json"),
  ).version;
  const desktopPackage = readJson<{ description?: string }>(
    NodePath.join(desktopDir, "package.json"),
  );
  log(
    `Otter Mail ${options.version} for ${options.platform}/${options.target} (arch=${options.arch}, ` +
      `update feed=${resolvePublishConfig(options.version, process.env) ? "yes" : "none"}, signed=${options.signed})`,
  );

  if (!options.skipBuild) {
    // Same as the packages' `build` scripts, without needing pnpm on PATH.
    run(vpBin, ["build"], {
      cwd: webDir,
      env: { ...process.env, OTTER_MAIL_VERSION: options.version },
      label: "(apps/web) vp build",
    });
    run(vpBin, ["pack"], {
      cwd: desktopDir,
      env: { ...process.env, OTTER_MAIL_VERSION: options.version },
      label: `(apps/desktop) OTTER_MAIL_VERSION=${options.version} vp pack`,
    });
    // Before staging: it writes the debug ids that pair the bundles with their maps.
    uploadSourcemaps(SENTRY_PROJECTS.desktop, [
      NodePath.join(desktopDir, "dist-electron"),
      NodePath.join(webDir, "dist"),
    ]);
  }
  const translatorBinary = mac ? resolveTranslatorBinary(options) : null;

  const requiredInputs = [
    NodePath.join(desktopDir, "dist-electron", "main.cjs"),
    NodePath.join(desktopDir, "dist-electron", "backend.cjs"),
    NodePath.join(desktopDir, "dist-electron", "preload.cjs"),
    NodePath.join(webDir, "dist", "index.html"),
  ];
  const missing = requiredInputs.filter((path) => !NodeFS.existsSync(path));
  if (missing.length > 0) {
    fail(`Missing build output (drop --skip-build?):\n  ${missing.join("\n  ")}`);
  }

  const stageDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-stage-"));
  log(`Staging in ${stageDir}`);
  const notMap = (source: string) => !source.endsWith(".map");
  copyDir(
    NodePath.join(desktopDir, "dist-electron"),
    NodePath.join(stageDir, "dist-electron"),
    notMap,
  );
  copyDir(NodePath.join(webDir, "dist"), NodePath.join(stageDir, "renderer"), notMap);
  copyDir(NodePath.join(desktopDir, "resources"), NodePath.join(stageDir, "resources"));
  if (translatorBinary) {
    NodeFS.mkdirSync(NodePath.join(stageDir, "bin"));
    NodeFS.copyFileSync(translatorBinary, NodePath.join(stageDir, "bin", "translator"));
    NodeFS.chmodSync(NodePath.join(stageDir, "bin", "translator"), 0o755);
  }

  let entitlementsPath: string | undefined;
  if (options.signed) {
    entitlementsPath = NodePath.join(stageDir, "entitlements.mac.plist");
    NodeFS.writeFileSync(entitlementsPath, ENTITLEMENTS);
  }

  const stagedPackageJson = {
    name: "otter-mail",
    productName: productName(options.platform),
    version: options.version,
    description: desktopPackage.description ?? "Gmail, calm and fast.",
    author: MAINTAINER,
    homepage: "https://otterware.app/mail/",
    ...(mac ? {} : { desktopName: `${LINUX_NAME}.desktop` }),
    main: "dist-electron/main.cjs",
    devDependencies: { electron: electronVersion },
    build: createBuildConfig({
      platform: options.platform,
      version: options.version,
      target: options.target,
      signed: options.signed,
      electronVersion,
      entitlementsPath,
      env: process.env,
    }),
  };
  NodeFS.writeFileSync(
    NodePath.join(stageDir, "package.json"),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
  );

  const buildEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === "") delete buildEnv[key];
  }
  if (options.signed) {
    const required = [
      ...(buildEnv.CSC_NAME ? [] : ["CSC_LINK", "CSC_KEY_PASSWORD"]),
      "APPLE_API_KEY",
      "APPLE_API_KEY_ID",
      "APPLE_API_ISSUER",
    ];
    const absent = required.filter((key) => !buildEnv[key]);
    if (absent.length > 0) fail(`--signed needs ${absent.join(", ")}.`);
  } else {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    for (const key of Object.keys(buildEnv)) {
      if (key.startsWith("CSC_") && key !== "CSC_IDENTITY_AUTO_DISCOVERY") delete buildEnv[key];
      if (key.startsWith("APPLE_")) delete buildEnv[key];
    }
  }
  if (options.verbose) {
    buildEnv.DEBUG = [
      buildEnv.DEBUG,
      "electron-builder",
      "electron-osx-sign*",
      "electron-notarize*",
    ]
      .filter(Boolean)
      .join(",");
  }

  const builderArgs = [
    "--projectDir",
    stageDir,
    mac ? "--mac" : "--linux",
    `--${options.arch}`,
    "--publish",
    "never",
  ];
  run(electronBuilderBin, builderArgs, {
    env: buildEnv,
    label: `electron-builder ${builderArgs.join(" ")}`,
  });

  const distDir = NodePath.join(stageDir, "dist");
  const artifacts = NodeFS.readdirSync(distDir).filter(
    (name) =>
      /\.(dmg|zip|deb|blockmap|yml)$/.test(name) &&
      name !== "builder-debug.yml" &&
      name !== "builder-effective-config.yaml",
  );
  if (!artifacts.some((name) => /\.(dmg|zip|deb)$/.test(name))) {
    fail(`electron-builder produced no artifacts in ${distDir}.`);
  }
  NodeFS.mkdirSync(options.outputDir, { recursive: true });
  for (const name of artifacts) {
    NodeFS.copyFileSync(NodePath.join(distDir, name), NodePath.join(options.outputDir, name));
    log(`-> ${NodePath.join(options.outputDir, name)}`);
  }

  if (options.keepStage) {
    log(`Kept stage at ${stageDir}`);
  } else {
    NodeFS.rmSync(stageDir, { recursive: true, force: true });
  }
}

if (import.meta.main) main();
