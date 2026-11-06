#!/usr/bin/env node
// Bundle Mode's Babel plugin writes each worklet to
// react-native-worklets/.worklets/<hash>.js while Metro transforms, after
// Metro crawled its file map, so a one-shot Release bundle (Xcode's "Bundle
// React Native code", EAS) fails with "Failed to get the SHA-1" the first
// time. One throwaway bundle first writes them; the real one then finds them.
//
//   node scripts/warm-worklets.mts   (from apps/mobile; ios:release runs it)

import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const out = NodePath.join(NodeOS.tmpdir(), "otter-mail-worklets-warmup");
for (let attempt = 1; attempt <= 3; attempt++) {
  const result = NodeChildProcess.spawnSync(
    "npx",
    [
      "expo",
      "export:embed",
      "--platform",
      "ios",
      "--dev",
      "false",
      "--entry-file",
      "index.ts",
      "--bundle-output",
      NodePath.join(out, "main.jsbundle"),
      "--assets-dest",
      out,
    ],
    { cwd: NodePath.resolve(import.meta.dirname, ".."), encoding: "utf8" },
  );
  if (result.status === 0) {
    console.log(`Worklets ready (pass ${attempt}).`);
    process.exit(0);
  }
  if (!`${result.stdout}${result.stderr}`.includes("Failed to get the SHA-1")) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}
console.error("The worklet files still aren't in Metro's file map after three passes.");
process.exit(1);
