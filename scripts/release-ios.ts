#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const project = NodePath.join(root, "apps/ios/OtterMail.xcodeproj");
const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-mail-ios-"));

function fail(message: string): never {
  console.error(`[release-ios] ${message}`);
  process.exit(1);
}

function run(command: string, args: string[]): void {
  console.log(`[release-ios] ${command} ${args.join(" ")}`);
  NodeChildProcess.execFileSync(command, args, { stdio: "inherit" });
}

const versionFlag = process.argv.indexOf("--version");
const version =
  versionFlag > 0
    ? process.argv[versionFlag + 1]
    : /MARKETING_VERSION = ([^;]+);/.exec(
        NodeFS.readFileSync(NodePath.join(project, "project.pbxproj"), "utf8"),
      )?.[1];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" isn't a version (x.y.z).`);
// Every upload needs a new build number; the time always goes up.
const build = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

const signing = NodePath.join(NodeOS.homedir(), ".otter-mail/signing");
const keyPath =
  process.env.OTTER_MAIL_ASC_KEY ??
  NodeFS.readdirSync(signing, { withFileTypes: true })
    .filter((f) => /^AuthKey_\w+\.p8$/.test(f.name))
    .map((f) => NodePath.join(signing, f.name))[0];
if (!keyPath) fail("No App Store Connect API key (OTTER_MAIL_ASC_KEY, or ~/.otter-mail/signing).");
const keyId = process.env.OTTER_MAIL_ASC_KEY_ID ?? /AuthKey_(\w+)\.p8$/.exec(keyPath)?.[1];
const issuer = process.env.OTTER_MAIL_ASC_ISSUER ?? "b010c56a-fe59-481d-a7db-7350e51eb8b8";
const auth = [
  "-authenticationKeyPath",
  keyPath,
  "-authenticationKeyID",
  keyId!,
  "-authenticationKeyIssuerID",
  issuer,
];

run("node", [NodePath.join(root, "scripts/export-ios-resources.ts")]);

const archive = NodePath.join(work, "OtterMail.xcarchive");
run("xcodebuild", [
  "-project",
  project,
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
  "-quiet",
  "archive",
]);

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

NodeFS.rmSync(work, { recursive: true, force: true });
console.log(
  `[release-ios] Uploaded ${version} (${build}). It shows up in TestFlight once Apple has processed it.`,
);
