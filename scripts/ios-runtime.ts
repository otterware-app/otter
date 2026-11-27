#!/usr/bin/env node
// Whether a release of an iPhone app (Otter Mail, Otter Agents) needs a new build or ships as an
// update. The native app's fingerprint (Expo's, with the app's fingerprint.config.cjs) is its
// runtime version: each build records it in its tag, and a change whose fingerprint is the last
// build's reaches that build as an update instead (expo-updates, published with EAS Update).

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

export const APPS = {
  mail: { name: "Otter Mail", dir: "apps/mail-mobile", tags: "ios-v*", env: "OTTER_MAIL" },
  agents: {
    name: "Otter Agents",
    dir: "apps/agents-mobile",
    tags: "ios-agents-v*",
    env: "OTTER_AGENTS",
  },
} as const;
export type IosApp = keyof typeof APPS;

/** How a build's tag says what it runs, as release.yml's "Tag, bump and push" writes it. */
export function recordedRuntime(app: IosApp, tagContents: string): string | undefined {
  return new RegExp(`^${APPS[app].name} runtime: ([0-9a-f]{40})$`, "m").exec(tagContents)?.[1];
}

/** The native app's fingerprint, as a release build sees its app config. */
function fingerprint(app: IosApp): string {
  const { env: prefix, dir } = APPS[app];
  const env = { ...process.env };
  delete env[`${prefix}_RUNTIME_VERSION`];
  const output = NodeChildProcess.execFileSync(
    "pnpm",
    ["exec", "expo-updates", "fingerprint:generate", "--platform", "ios"],
    {
      cwd: NodePath.join(repoRoot, dir),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...env,
        OTTER_APP_VARIANT: "production",
        [`${prefix}_RELEASE_BUILD`]: "1",
        EXPO_NO_DOTENV: "1",
      },
    },
  );
  const hash = (JSON.parse(output.slice(output.indexOf("{"))) as { hash?: string }).hash;
  if (!hash || !/^[0-9a-f]{40}$/.test(hash)) throw new Error("No fingerprint from expo-updates.");
  return hash;
}

/** What the newest build released from this branch runs. */
function lastBuildRuntime(app: IosApp): string | undefined {
  const contents = NodeChildProcess.execFileSync(
    "git",
    [
      "tag",
      "--list",
      APPS[app].tags,
      "--sort=-creatordate",
      "--merged",
      "HEAD",
      "--format=%(contents)%00",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return recordedRuntime(app, contents.split("\0")[0] ?? "");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      app: { type: "string" },
      build: { type: "boolean", default: false },
      "github-output": { type: "boolean", default: false },
    },
  });
  const app = values.app as IosApp;
  if (!(app in APPS)) throw new Error(`--app is mail or agents, not "${values.app}".`);
  const runtime = fingerprint(app);
  const last = lastBuildRuntime(app);
  const mode = values.build || runtime !== last ? "build" : "update";
  const why = values.build
    ? "a build was asked for"
    : last
      ? runtime === last
        ? "its native code is the last build's"
        : `its native code changed (the last build runs ${last})`
      : "no build records what it runs";
  const summary = `${APPS[app].name} ${mode === "build" ? "builds" : "ships as an update"}: ${why}. Runtime ${runtime}.`;
  console.log(summary);
  if (values["github-output"]) {
    const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
    if (GITHUB_OUTPUT) NodeFS.appendFileSync(GITHUB_OUTPUT, `runtime=${runtime}\nmode=${mode}\n`);
    if (GITHUB_STEP_SUMMARY) NodeFS.appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (import.meta.main) main();
