#!/usr/bin/env node
// Run after building and before packaging: inject writes debug IDs into bundles and maps.

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const sentryCli = NodePath.join(repoRoot, "node_modules", ".bin", "sentry-cli");

export const SENTRY_PROJECTS = { desktop: "otter-mail-desktop", web: "otter-mail-web" } as const;

export function uploadSourcemaps(project: string, dirs: readonly string[]): void {
  const { SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org } = process.env;
  if (!token || !org) {
    console.log("Source maps: no SENTRY_AUTH_TOKEN and SENTRY_ORG, not uploading.");
    return;
  }
  const run = (args: string[]) => {
    const result = NodeChildProcess.spawnSync(sentryCli, args, { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`sentry-cli ${args[0]} ${args[1]} failed.`);
  };
  run(["sourcemaps", "inject", ...dirs]);
  run(["sourcemaps", "upload", "--org", org, "--project", project, ...dirs]);
}

if (import.meta.main) {
  const [app, ...dirs] = process.argv.slice(2);
  const project = SENTRY_PROJECTS[app as keyof typeof SENTRY_PROJECTS];
  if (!project || dirs.length === 0) {
    console.error("Usage: node scripts/upload-sourcemaps.ts <desktop|web> <dir>...");
    process.exit(1);
  }
  uploadSourcemaps(project, dirs);
}
