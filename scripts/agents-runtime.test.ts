import assert from "node:assert/strict";
import { test } from "node:test";
import { recordedRuntime, runtimeRecord } from "./agents-runtime.ts";

const runtime = "43d3a29094a6216a1b5f8813848bc76461d4eed1";

test("a build's tag gives back the runtime it recorded", () => {
  assert.equal(recordedRuntime(runtimeRecord(runtime)), runtime);
  assert.equal(recordedRuntime(`${runtimeRecord(runtime)}\n`), runtime);
});

test("a tag that records none (a build from before updates, or a lightweight tag) gives none", () => {
  assert.equal(recordedRuntime(""), undefined);
  assert.equal(recordedRuntime("chore(release): ios-agents-v0.2.4"), undefined);
});
