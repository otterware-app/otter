#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import { otterHome } from "../apps/desktop/scripts/dev-home.mjs";
import * as NodePath from "node:path";

const APPS = {
  mail: {
    project: "apps/mail-mobile",
    versionEnv: "OTTER_MAIL_RELEASE_VERSION",
    buildEnv: "OTTER_MAIL_RELEASE_BUILD",
    scheme: "OtterMail",
    profiles: {
      "dev.otterware.mail": "Otter Mail App Store",
      "dev.otterware.mail.notifications": "Otter Mail Notifications App Store",
    },
    sentryProject: "otter-mail-ios",
  },
  agents: {
    project: "apps/agents-mobile",
    versionEnv: "OTTER_AGENTS_RELEASE_VERSION",
    buildEnv: "OTTER_AGENTS_RELEASE_BUILD",
    scheme: "OtterAgents",
    profiles: {
      "dev.otterware.agents": "Otter Agents App Store",
      "dev.otterware.agents.notifications": "Otter Agents Notifications App Store",
    },
    sentryProject: "otter-agents-ios",
  },
};

const root = NodePath.resolve(import.meta.dirname, "..");
const appFlag = process.argv.indexOf("--app");
const appName = appFlag > 0 ? process.argv[appFlag + 1]! : "mail";
const app = APPS[appName as keyof typeof APPS];
if (!app) {
  console.error(`[release-ios] Unknown app: ${appName} (mail, agents).`);
  process.exit(1);
}
const project = NodePath.join(root, app.project);
const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otter-ios-"));

function fail(message: string): never {
  console.error(`[release-ios] ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], cwd = root): void {
  console.log(`[release-ios] ${command} ${args.join(" ")}`);
  NodeChildProcess.execFileSync(command, args, { stdio: "inherit", cwd });
}

function sourceVersion(): string | undefined {
  return (
    JSON.parse(NodeFS.readFileSync(NodePath.join(project, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
}

const versionFlag = process.argv.indexOf("--version");
const version = versionFlag > 0 ? process.argv[versionFlag + 1] : sourceVersion();
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail(`"${version}" isn't a version (x.y.z).`);
const build = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

const signing = NodePath.join(otterHome(), "signing");
const keyPath =
  process.env.OTTER_ASC_KEY ??
  NodeFS.readdirSync(signing, { withFileTypes: true })
    .filter((f) => /^AuthKey_\w+\.p8$/.test(f.name))
    .map((f) => NodePath.join(signing, f.name))[0];
if (!keyPath) fail("No App Store Connect API key (OTTER_ASC_KEY, or ~/.otter/signing).");
const keyId = process.env.OTTER_ASC_KEY_ID ?? /AuthKey_(\w+)\.p8$/.exec(keyPath)?.[1];
const issuer = process.env.OTTER_ASC_ISSUER ?? "b010c56a-fe59-481d-a7db-7350e51eb8b8";
const auth = [
  "-authenticationKeyPath",
  keyPath,
  "-authenticationKeyID",
  keyId!,
  "-authenticationKeyIssuerID",
  issuer,
];

process.env.OTTER_APP_VARIANT = "production";
process.env[app.versionEnv] = version;
process.env[app.buildEnv] = build;
process.env.EXPO_NO_DOTENV = "1";
process.env.EXPO_NO_CLIENT_ENV_VARS = "1";
// Sentry's build phases upload the source maps (with debug IDs: no release of their own); a
// failed upload doesn't stop the release. Without a token prebuild leaves them out (app.config.ts).
process.env.AUTO_RELEASE = "false";
process.env.SENTRY_ALLOW_FAILURE = "true";
run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--clean", "--no-install"], project);
run("pod", ["install"], NodePath.join(project, "ios"));

const archive = NodePath.join(work, `${app.scheme}.xcarchive`);
// Xcode's compilation cache keys each Swift and Clang compile by its inputs, so a build reuses
// what an earlier one compiled. The Release workflow keeps OTTER_IOS_DERIVED_DATA's
// CompilationCache.noindex between runs.
const derivedData = process.env.OTTER_IOS_DERIVED_DATA;
run("xcodebuild", [
  ...(derivedData ? ["-derivedDataPath", derivedData] : []),
  "-workspace",
  NodePath.join(project, "ios", `${app.scheme}.xcworkspace`),
  "-scheme",
  app.scheme,
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "-archivePath",
  archive,
  `MARKETING_VERSION=${version}`,
  `CURRENT_PROJECT_VERSION=${build}`,
  "COMPILATION_CACHE_ENABLE_CACHING=YES",
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
${Object.entries(app.profiles)
  .map(([id, profile]) => `    <key>${id}</key><string>${profile}</string>`)
  .join("\n")}
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

const { SENTRY_AUTH_TOKEN: sentryToken, SENTRY_ORG: sentryOrg } = process.env;
if (app.sentryProject && sentryToken && sentryOrg) {
  try {
    run("npx", [
      "--yes",
      "@sentry/cli@3.8.0",
      "debug-files",
      "upload",
      "--org",
      sentryOrg,
      "--project",
      app.sentryProject,
      NodePath.join(archive, "dSYMs"),
    ]);
  } catch {
    console.warn("[release-ios] Couldn't upload the dSYMs to Sentry.");
  }
} else if (app.sentryProject) {
  console.log("[release-ios] No SENTRY_AUTH_TOKEN and SENTRY_ORG, not uploading dSYMs.");
}

NodeFS.rmSync(work, { recursive: true, force: true });
if (process.argv.includes("--github-output") && process.env.GITHUB_OUTPUT) {
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `build=${build}\n`);
}
console.log(
  `[release-ios] Uploaded ${version} (${build}). It shows up in TestFlight once Apple has processed it.`,
);
