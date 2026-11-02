#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { parseArgs } from "node:util";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
export const RELEASE_PACKAGE_FILES = ["apps/desktop/package.json", "apps/web/package.json"];

export function updateReleasePackageVersions(version: string, root = repoRoot): string[] {
  const changed: string[] = [];
  for (const file of RELEASE_PACKAGE_FILES) {
    const path = NodePath.join(root, file);
    const source = NodeFS.readFileSync(path, "utf8");
    const packageJson = JSON.parse(source) as { version?: string };
    if (packageJson.version === version) continue;
    const updated = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
    NodeFS.writeFileSync(path, updated);
    changed.push(file);
  }
  return changed;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "github-output": { type: "boolean", default: false } },
  });
  const version = positionals[0]?.replace(/^v/, "") ?? "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(
      "Usage: node scripts/update-release-package-versions.ts <x.y.z> [--github-output]",
    );
    process.exit(1);
  }
  const changed = updateReleasePackageVersions(version);
  console.log(
    changed.length > 0 ? `Updated ${changed.join(", ")} to ${version}` : "Already up to date",
  );
  if (values["github-output"] && process.env.GITHUB_OUTPUT) {
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length > 0}\n`);
  }
}
