#!/usr/bin/env node
// Writes design/tokens.json, the variables design/otter.pen draws with, and
// packages/ui-native/src/tokens.ts, the same tokens for the iPhone apps, from
// @otter/ui's tokens.css and globals.css. `--check` fails when either is stale.
import { readFileSync, writeFileSync } from "node:fs";

import { nativeTokensModule, penVariables } from "../packages/ui/src/tokens.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const tokensCss = read("packages/ui/src/styles/tokens.css");
const globalsCss = read("packages/ui/src/styles/globals.css");

const outputs = {
  "design/tokens.json": `${JSON.stringify(penVariables(tokensCss, globalsCss), null, 2)}\n`,
  "packages/ui-native/src/tokens.ts": nativeTokensModule(tokensCss, globalsCss),
};

for (const [path, next] of Object.entries(outputs)) {
  const out = new URL(path, root);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {}
    if (current !== next) {
      console.error(`${path} is stale: run \`pnpm design:tokens\`.`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(out, next);
    console.log(`Wrote ${path}`);
  }
}
