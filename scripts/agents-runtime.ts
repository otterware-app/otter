#!/usr/bin/env node
// Whether a release of Otter Agents needs a new build or ships as an update. The native app's
// fingerprint (Expo's, with apps/agents-mobile/fingerprint.config.cjs) is its runtime version:
// each build records it in its tag, and a change whose fingerprint is the last build's reaches
// that build as an update instead (expo-updates, published with EAS Update).

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const app = NodePath.join(repoRoot, "apps/agents-mobile");
/** How a build's tag says what it runs. */
const RECORD = /^Otter Agents runtime: ([0-9a-f]{40})$/m;

export function recordedRuntime(tagContents: string): string | undefined {
  return RECORD.exec(tagContents)?.[1];
}

/** The native app's fingerprint, as a release build sees its app config. */
function fingerprint(): string {
  const { OTTER_AGENTS_RUNTIME_VERSION: _, ...env } = process.env;
  const output = NodeChildProcess.execFileSync(
    "pnpm",
    ["exec", "expo-updates", "fingerprint:generate", "--platform", "ios"],
    {
      cwd: app,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...env,
        OTTER_APP_VARIANT: "production",
        OTTER_AGENTS_RELEASE_BUILD: "1",
        EXPO_NO_DOTENV: "1",
      },
    },
  );
  const hash = (JSON.parse(output.slice(output.indexOf("{"))) as { hash?: string }).hash;
  if (!hash || !/^[0-9a-f]{40}$/.test(hash)) throw new Error("No fingerprint from expo-updates.");
  return hash;
}

/** What the newest build released from this branch runs. */
function lastBuildRuntime(): string | undefined {
  const contents = NodeChildProcess.execFileSync(
    "git",
    [
      "tag",
      "--list",
      "ios-agents-v*",
      "--sort=-creatordate",
      "--merged",
      "HEAD",
      "--format=%(contents)%00",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return recordedRuntime(contents.split("\0")[0] ?? "");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      build: { type: "boolean", default: false },
      "github-output": { type: "boolean", default: false },
    },
  });
  const runtime = fingerprint();
  const last = lastBuildRuntime();
  const mode = values.build || runtime !== last ? "build" : "update";
  const why = values.build
    ? "a build was asked for"
    : last
      ? runtime === last
        ? "its native code is the last build's"
        : `its native code changed (the last build runs ${last})`
      : "no build records what it runs";
  const summary = `Otter Agents ${mode === "build" ? "builds" : "ships as an update"}: ${why}. Runtime ${runtime}.`;
  console.log(summary);
  if (values["github-output"]) {
    const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
    if (GITHUB_OUTPUT) NodeFS.appendFileSync(GITHUB_OUTPUT, `runtime=${runtime}\nmode=${mode}\n`);
    if (GITHUB_STEP_SUMMARY) NodeFS.appendFileSync(GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (import.meta.main) main();
