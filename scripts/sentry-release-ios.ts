#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import { parseArgs } from "node:util";

const SENTRY_CLI = "@sentry/cli@3.8.0";

// Each app's Sentry project, which is also the name its releases start with, and its tags.
const APPS = {
  mail: { project: "otter-mail-ios", tag: "ios-v" },
  agents: { project: "otter-agents-ios", tag: "ios-agents-v" },
};
export type IosApp = keyof typeof APPS;

function iosApp(app: string): IosApp {
  if (!(app in APPS)) throw new Error(`Unknown app: ${app} (mail, agents).`);
  return app as IosApp;
}

// The name the app reports under (each app's src/error-reports.ts):
// its version and build number.
export function iosSentryRelease(app: IosApp, version: string, build: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" isn't a version (x.y.z).`);
  if (!/^\d{12}$/.test(build)) throw new Error(`"${build}" isn't a build number (YYYYMMDDhhmm).`);
  return `${APPS[app].project}@${version}+${build}`;
}

function parseVersion(version: string): number[] {
  return version.split(".").map(Number);
}

function compareVersions(a: string, b: string): number {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

// The release before this one: the app's highest tag (ios-vX.Y.Z, ios-agents-vX.Y.Z) below
// it. A rerun after the workflow has tagged this version skips its own tag.
export function previousIosTag(
  app: IosApp,
  tags: readonly string[],
  version: string,
): string | undefined {
  const prefix = APPS[app].tag;
  return tags
    .map((tag) => (tag.startsWith(prefix) ? tag.slice(prefix.length) : undefined))
    .filter((v): v is string => v !== undefined && /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => compareVersions(v, version) < 0)
    .sort(compareVersions)
    .map((v) => `${prefix}${v}`)
    .at(-1);
}

// An explicit range, so Sentry doesn't look for the previous release with commits itself:
// without one (an app's first) it would take only the last 20.
export function iosCommitSpec(repository: string, previous: string, sha: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`"${repository}" isn't owner/repo.`);
  for (const s of [previous, sha]) {
    if (!/^[0-9a-f]{40}$/.test(s)) throw new Error(`"${s}" isn't a full commit SHA.`);
  }
  return `${repository}@${previous}..${sha}`;
}

function git(args: string[]): string {
  return NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
}

function sentry(step: string, args: string[]): void {
  console.log(`[sentry-release-ios] sentry-cli ${args.join(" ")}`);
  try {
    NodeChildProcess.execFileSync("npx", ["--yes", SENTRY_CLI, ...args], { stdio: "inherit" });
  } catch (error) {
    console.error(`::error::Sentry release: couldn't ${step} (sentry-cli ${args[1]}).`);
    throw error;
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      app: { type: "string", default: "mail" },
      version: { type: "string" },
      build: { type: "string" },
      ref: { type: "string", default: "HEAD" },
      repository: { type: "string", default: "otterware-app/otter" },
    },
  });
  for (const name of ["SENTRY_AUTH_TOKEN", "SENTRY_ORG"]) {
    if (!process.env[name]) throw new Error(`Missing ${name} (docs/error-reports.md).`);
  }
  const app = iosApp(values.app);
  const { project, tag } = APPS[app];
  const release = iosSentryRelease(app, values.version ?? "", values.build ?? "");
  const sha = git(["rev-parse", "--verify", `${values.ref}^{commit}`]);
  const tags = git(["tag", "--merged", sha, "--list", `${tag}*`]).split("\n");
  const previousTag = previousIosTag(app, tags, values.version!);
  if (!previousTag) throw new Error(`No ${tag}* tag before ${values.version} in ${sha}'s history.`);
  const previous = git(["rev-parse", "--verify", `${previousTag}^{commit}`]);
  const commits = iosCommitSpec(values.repository, previous, sha);
  console.log(`[sentry-release-ios] ${release}: ${previousTag}..${sha}`);

  sentry("create the release", ["releases", "new", release, "--project", project]);
  sentry("attach its commits", ["releases", "set-commits", release, "--commit", commits]);
  sentry("finalize the release", ["releases", "finalize", release]);

  if (process.env.GITHUB_STEP_SUMMARY) {
    NodeFS.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Sentry release \`${release}\` (${project}): commits \`${previousTag}..${sha.slice(0, 12)}\`, ` +
        `https://${process.env.SENTRY_ORG}.sentry.io/releases/${encodeURIComponent(release)}/\n`,
    );
  }
}

if (import.meta.main) main();
