#!/usr/bin/env node
// Writes design/tokens.json, the variables design/otter.pen draws with, from
// @otter/ui's tokens.css and globals.css. `--check` fails when it is stale.
import { readFileSync, writeFileSync } from "node:fs";

import { penVariables } from "../packages/ui/src/tokens.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const out = new URL("design/tokens.json", root);

const next = `${JSON.stringify(
  penVariables(
    read("packages/ui/src/styles/tokens.css"),
    read("packages/ui/src/styles/globals.css"),
  ),
  null,
  2,
)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  if (current !== next) {
    console.error("design/tokens.json is stale: run `pnpm design:tokens`.");
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
  console.log("Wrote design/tokens.json");
}
