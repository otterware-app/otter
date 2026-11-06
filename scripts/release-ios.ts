#!/usr/bin/env node
// Builds the iPhone app (apps/mobile's production variant) and uploads it to App Store Connect:
// an Expo prebuild, an Xcode archive signed with the App Store profiles, the export's upload,
// and the dSYMs and Hermes source maps to Sentry. `--unsigned` stops at an unsigned archive.
//
//   pnpm release:ios [--version x.y.z] [--unsigned] [--github-output]

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const mobile = NodePath.join(root, "apps/mobile");
const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-ios-"));
const unsigned = process.argv.includes("--unsigned");

function fail(message: string): never {
  console.error(`[release-ios] ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd = root): void {
  console.log(`[release-ios] ${command} ${args.join(" ")}`);
  NodeChildProcess.execFileSync(command, args, {
    stdio: "inherit",
    cwd,
    env: { ...process.env, ...env },
  });
}

const versionFlag = process.argv.indexOf("--version");
const version =
  versionFlag > 0
    ? process.argv[versionFlag + 1]
    : (
        JSON.parse(NodeFS.readFileSync(NodePath.join(mobile, "package.json"), "utf8")) as {
          version: string;
        }
      ).version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" isn't a version (x.y.z).`);
const build = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

let auth: string[] = [];
if (!unsigned) {
  const signing = NodePath.join(NodeOS.homedir(), ".otter-mail/signing");
  const keyPath =
    process.env.OTTER_MAIL_ASC_KEY ??
    NodeFS.readdirSync(signing, { withFileTypes: true })
      .filter((f) => /^AuthKey_\w+\.p8$/.test(f.name))
      .map((f) => NodePath.join(signing, f.name))[0];
  if (!keyPath)
    fail("No App Store Connect API key (OTTER_MAIL_ASC_KEY, or ~/.otter-mail/signing).");
  const keyId = process.env.OTTER_MAIL_ASC_KEY_ID ?? /AuthKey_(\w+)\.p8$/.exec(keyPath)?.[1];
  const issuer = process.env.OTTER_MAIL_ASC_ISSUER ?? "b010c56a-fe59-481d-a7db-7350e51eb8b8";
  auth = [
    "-authenticationKeyPath",
    keyPath,
    "-authenticationKeyID",
    keyId!,
    "-authenticationKeyIssuerID",
    issuer,
  ];
}

// The release's version in the bundled config too (package.json has the last one released).
run(
  "npx",
  ["expo", "prebuild", "--clean", "--platform", "ios"],
  {
    APP_VARIANT: "production",
    OTTER_MAIL_MOBILE_VERSION: version,
    EXPO_NO_GIT_STATUS: "1",
    ...(unsigned ? {} : { OTTER_MAIL_RELEASE_SIGNING: "1" }),
  },
  mobile,
);

const archive = NodePath.join(work, "OtterMail.xcarchive");
const sourceMap = NodePath.join(work, "main.jsbundle.map");
run(
  "xcodebuild",
  [
    "-workspace",
    NodePath.join(mobile, "ios/OtterMail.xcworkspace"),
    "-scheme",
    "OtterMail",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archive,
    `MARKETING_VERSION=${version}`,
    `CURRENT_PROJECT_VERSION=${build}`,
    ...(unsigned ? ["CODE_SIGNING_ALLOWED=NO"] : []),
    "-quiet",
    "archive",
  ],
  // React Native's bundle phase writes the Hermes source map (composed) here.
  { SOURCEMAP_FILE: sourceMap },
);
const applications = NodePath.join(archive, "Products/Applications");
const app = NodePath.join(
  applications,
  NodeFS.readdirSync(applications).find((name) => name.endsWith(".app")) ??
    fail("No app archived."),
);
for (const plist of [
  NodePath.join(app, "Info.plist"),
  NodePath.join(app, "PlugIns/OtterMailNotificationService.appex/Info.plist"),
]) {
  const read = (key: string) =>
    NodeChildProcess.execFileSync("plutil", ["-extract", key, "raw", plist], {
      encoding: "utf8",
    }).trim();
  const found = `${read("CFBundleShortVersionString")} (${read("CFBundleVersion")})`;
  if (found !== `${version} (${build})`)
    fail(`${NodePath.relative(work, plist)} says ${found}, not ${version} (${build}).`);
}

if (unsigned) {
  console.log(`[release-ios] Archived ${version} (${build}), unsigned: ${archive}`);
  process.exit(0);
}

const options = NodePath.join(work, "ExportOptions.plist");
NodeFS.writeFileSync(
  options,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>838JVGY7W4</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>dev.otterware.mail</key><string>Otter Mail App Store</string>
    <key>dev.otterware.mail.notifications</key><string>Otter Mail Notifications App Store</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`,
);
run("xcodebuild", [
  "-exportArchive",
  "-archivePath",
  archive,
  "-exportOptionsPlist",
  options,
  "-exportPath",
  NodePath.join(work, "export"),
  ...auth,
]);

// Symbols for native crashes, and the source map for JS errors (the UI's and the worker's:
// both run main.jsbundle), under the release and dist the app reports (src/error-reports.ts).
const { SENTRY_AUTH_TOKEN: sentryToken, SENTRY_ORG: sentryOrg } = process.env;
if (sentryToken && sentryOrg) {
  const sentry = (args: string[]) =>
    run("npx", [
      "--yes",
      "@sentry/cli@3.8.0",
      ...args,
      "--org",
      sentryOrg,
      "--project",
      "otter-mail-ios",
    ]);
  try {
    sentry(["debug-files", "upload", NodePath.join(archive, "dSYMs")]);
  } catch {
    console.warn("[release-ios] Couldn't upload the dSYMs to Sentry.");
  }
  try {
    const maps = NodePath.join(work, "sourcemaps");
    NodeFS.mkdirSync(maps);
    NodeFS.copyFileSync(NodePath.join(app, "main.jsbundle"), NodePath.join(maps, "main.jsbundle"));
    NodeFS.copyFileSync(sourceMap, NodePath.join(maps, "main.jsbundle.map"));
    sentry([
      "sourcemaps",
      "upload",
      "--release",
      `otter-mail-ios@${version}+${build}`,
      "--dist",
      build,
      "--strip-prefix",
      root,
      maps,
    ]);
  } catch {
    console.warn("[release-ios] Couldn't upload the source maps to Sentry.");
  }
} else {
  console.log("[release-ios] No SENTRY_AUTH_TOKEN and SENTRY_ORG, not uploading to Sentry.");
}

NodeFS.rmSync(work, { recursive: true, force: true });
if (process.argv.includes("--github-output") && process.env.GITHUB_OUTPUT) {
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
}
console.log(
  `[release-ios] Uploaded ${version} (${build}). It shows up in TestFlight once Apple has processed it.`,
);
