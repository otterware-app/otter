import assert from "node:assert/strict";
import { test } from "node:test";
import { recordedRuntime } from "./agents-runtime.ts";

const runtime = "43d3a29094a6216a1b5f8813848bc76461d4eed1";

test("a build's tag gives back the runtime it recorded", () => {
  // As release.yml's "Tag, bump and push" writes it.
  assert.equal(recordedRuntime(`Otter Agents runtime: ${runtime}`), runtime);
  assert.equal(recordedRuntime(`Otter Agents runtime: ${runtime}\n`), runtime);
});

test("a tag that records none (a build from before updates, or a lightweight tag) gives none", () => {
  assert.equal(recordedRuntime(""), undefined);
  assert.equal(recordedRuntime("chore(release): ios-agents-v0.2.4"), undefined);
});
