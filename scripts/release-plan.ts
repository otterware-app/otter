#!/usr/bin/env node
// Which apps a Release run ships. A push to main ships the apps its commits changed; a run by
// hand ships whatever main has that an app's last release doesn't (or the apps it names).

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

export const APPS = ["desktop", "iphone", "agents"] as const;
export type App = (typeof APPS)[number];

const NAMES: Record<App, string> = {
  desktop: "Mac, Linux and web",
  iphone: "Otter Mail for iPhone",
  agents: "Otter Agents for iPhone",
};

// A path ending in "/" is a folder. The desktop and web apps are built from the whole
// repository, less what only another part ships (the iPhone apps, the relay, which Cloudflare
// deploys, and what is about the repository itself).
const NOT_DESKTOP = [
  "apps/agents-mobile/",
  "apps/mail-mobile/",
  "packages/mobile/",
  "packages/ui-native/",
  "infra/",
  "docs/",
  "changelog/",
  ".github/",
  ".agents/",
];
const IPHONE = [
  "apps/mail-mobile/",
  "packages/client/",
  "packages/contracts/",
  "packages/core/",
  "packages/mobile/",
  "packages/shared/",
  "packages/ui-native/",
  "extensions/translation/core/",
  "extensions/translation/manifest.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/",
  "scripts/release-ios.ts",
];
const AGENTS = [
  "apps/agents-mobile/",
  "packages/client/",
  "packages/contracts/",
  "packages/core/",
  "packages/mobile/",
  "packages/shared/",
  "packages/ui-native/",
  "extensions/claude/mobile/",
  "extensions/claude/shared/",
  "extensions/codex/mobile/",
  "extensions/codex/shared/",
  "extensions/hermes/",
  "extensions/openclaw/",
  "extensions/varys/",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/",
  "scripts/agents-runtime.ts",
  "scripts/release-ios.ts",
];

const within = (file: string, paths: readonly string[]) =>
  paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));

// An extension's ./mobile half is built into the Expo apps alone.
const MOBILE_HALF = /^extensions\/[^/]+\/mobile\//;

// A README is about the code beside it, and in no app.
const README = /(^|\/)README\.md$/;

export function ships(app: App, files: readonly string[]): boolean {
  const built = files.filter((file) => !README.test(file));
  if (app === "desktop")
    return built.some((file) => !within(file, NOT_DESKTOP) && !MOBILE_HALF.test(file));
  return built.some((file) => within(file, app === "iphone" ? IPHONE : AGENTS));
}

export interface Request {
  /** A stable release (a `vX.Y.Z` tag, or a run by hand with channel=stable) is the desktop app's. */
  readonly channel: "nightly" | "stable";
  /** "auto": the apps with changes. An app's name, or "all": those, whatever changed. */
  readonly apps: string;
  /** An exact version, which only one release can take. */
  readonly version?: string;
  /** The files changed for an app, or null when there is nothing to compare with. */
  readonly changed: (app: App) => readonly string[] | null;
}

export function plan(request: Request): Record<App, boolean> {
  const { channel, apps } = request;
  if (apps !== "auto" && apps !== "all" && !APPS.includes(apps as App)) {
    throw new Error(`Unknown apps: ${apps} (auto, all, ${APPS.join(", ")}).`);
  }
  if (channel === "stable") {
    if (apps !== "auto" && apps !== "desktop") {
      throw new Error(`A stable release is the ${NAMES.desktop} app's; drop apps=${apps}.`);
    }
    return { desktop: true, iphone: false, agents: false };
  }
  if (request.version && apps !== "iphone" && apps !== "agents") {
    throw new Error(
      "A version names one release: use it with channel=stable, apps=iphone or apps=agents.",
    );
  }
  const chosen = (app: App) => {
    if (apps === "all" || apps === app) return true;
    if (apps !== "auto") return false;
    const files = request.changed(app);
    return files === null || ships(app, files);
  };
  return { desktop: chosen("desktop"), iphone: chosen("iphone"), agents: chosen("agents") };
}

function git(args: readonly string[]): string {
  return NodeChildProcess.execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

const lines = (text: string) => text.split("\n").filter(Boolean);

function pushed(before: string, after: string): string[] | null {
  // A new branch, or a force push whose old tip is gone.
  if (/^0*$/.test(before)) return null;
  try {
    return lines(git(["diff", "--name-only", "--no-renames", before, after]));
  } catch {
    return null;
  }
}

// The newest release's tag: a nightly for the desktop app (a stable release is a nightly's
// commit), `ios-v*` and `ios-agents-v*` for the iPhone apps.
const TAGS: Record<App, string> = {
  desktop: "v*-nightly.*",
  iphone: "ios-v*",
  agents: "ios-agents-v*",
};

// Less the releases' own commits, which write the version they shipped into the app's files.
function unreleased(app: App): string[] | null {
  const tag = lines(
    git(["tag", "--list", TAGS[app], "--sort=-creatordate", "--merged", "HEAD"]),
  )[0];
  if (!tag) return null;
  return lines(
    git([
      "log",
      "--no-merges",
      "--invert-grep",
      "--grep=^chore(release): ",
      "--format=",
      "--name-only",
      "--no-renames",
      `${tag}..HEAD`,
    ]),
  );
}

function main(): void {
  const { values } = parseArgs({
    options: {
      event: { type: "string" },
      channel: { type: "string", default: "nightly" },
      apps: { type: "string", default: "auto" },
      version: { type: "string", default: "" },
      before: { type: "string", default: "" },
      after: { type: "string", default: "HEAD" },
      "github-output": { type: "boolean", default: false },
    },
  });
  if (values.channel !== "nightly" && values.channel !== "stable") {
    throw new Error(`Unknown release channel: ${values.channel}`);
  }
  const apps = values.apps.trim() || "auto";
  const push = values.event === "push" ? pushed(values.before, values.after) : undefined;
  const release = plan({
    channel: values.channel,
    apps,
    version: values.version.trim(),
    changed: (app) => (push === undefined ? unreleased(app) : push),
  });

  const why =
    values.channel === "stable"
      ? "a stable release"
      : apps !== "auto"
        ? `apps=${apps}`
        : values.event === "push"
          ? "what this push changed"
          : "what changed since each app's last release";
  const summary = [
    `Releasing by ${why}:`,
    ...APPS.map((app) => `- ${NAMES[app]}: ${release[app] ? "yes" : "no"}`),
  ].join("\n");
  console.log(summary);
  if (values["github-output"]) {
    const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
    const outputs = APPS.map((app) => `${app}=${release[app]}`).join("\n");
    if (GITHUB_OUTPUT) NodeFS.appendFileSync(GITHUB_OUTPUT, `${outputs}\n`);
    if (GITHUB_STEP_SUMMARY) NodeFS.appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (import.meta.main) main();
