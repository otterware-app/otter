import assert from "node:assert/strict";
import { test } from "node:test";
import { recordedRuntime } from "./ios-runtime.ts";

const runtime = "43d3a29094a6216a1b5f8813848bc76461d4eed1";

test("a build's tag gives back the runtime it recorded", () => {
  // As release.yml's "Tag, bump and push" writes it.
  assert.equal(recordedRuntime("agents", `Otter Agents runtime: ${runtime}`), runtime);
  assert.equal(recordedRuntime("agents", `Otter Agents runtime: ${runtime}\n`), runtime);
  assert.equal(recordedRuntime("mail", `Otter Mail runtime: ${runtime}`), runtime);
});

test("a tag that records none (a build from before updates, or a lightweight tag) gives none", () => {
  assert.equal(recordedRuntime("agents", ""), undefined);
  assert.equal(recordedRuntime("agents", "chore(release): ios-agents-v0.2.4"), undefined);
  assert.equal(recordedRuntime("mail", "chore(release): ios-v0.8.36"), undefined);
});

test("one app's record isn't the other's", () => {
  assert.equal(recordedRuntime("mail", `Otter Agents runtime: ${runtime}`), undefined);
});
