#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  changelogImageName,
  changelogUrl,
  parseChangelogEntry,
} from "../packages/shared/src/changelog.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

export function releaseNotes(version: string, text: string): string {
  const entry = parseChangelogEntry(version, text);
  const body = entry.body
    .replace(/^## /gm, "### ")
    .replace(/(!\[[^\]]*\]\()([^)\s]+)\)/g, (whole, open, src) => {
      const name = changelogImageName(src);
      return name ? `${open}${changelogUrl()}images/${name})` : whole;
    });
  return `## ${entry.title}\n\n${body}\n\n[Read it on the changelog →](${changelogUrl(version)})\n`;
}

function main(): void {
  const version = process.argv[2]?.replace(/^v/, "");
  if (!version) throw new Error("Usage: changelog-release-notes.ts <version>");
  const file = NodePath.join(repoRoot, "changelog", `${version}.md`);
  if (!NodeFS.existsSync(file)) return;
  process.stdout.write(releaseNotes(version, NodeFS.readFileSync(file, "utf8")));
}

if (import.meta.main) main();
