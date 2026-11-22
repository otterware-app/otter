import assert from "node:assert/strict";
import { test } from "node:test";
import { plan, ships, type App } from "./release-plan.ts";

const release = (apps: string, files: readonly string[] | null, channel = "nightly") =>
  plan({ channel: channel as "nightly" | "stable", apps, changed: () => files });

test("each app ships when what it is built from changed", () => {
  assert.deepEqual(release("auto", ["apps/web/src/main/app.tsx"]), {
    desktop: true,
    iphone: false,
    agents: false,
  });
  assert.deepEqual(release("auto", ["apps/ios/OtterMail/Mail/MessageList.swift"]), {
    desktop: false,
    iphone: true,
    agents: false,
  });
  assert.deepEqual(release("auto", ["apps/ios-agents/OtterAgents/Chats/Chat.swift"]), {
    desktop: false,
    iphone: false,
    agents: true,
  });
  // Otter Agents compiles Otter Mail's themes; both iPhone apps bundle packages/shared's demo.
  assert.deepEqual(release("auto", ["apps/ios/OtterMail/Theme/Palette.swift"]), {
    desktop: false,
    iphone: true,
    agents: true,
  });
  assert.deepEqual(release("auto", ["packages/shared/src/themes.ts"]), {
    desktop: true,
    iphone: true,
    agents: false,
  });
  assert.equal(ships("agents", ["apps/ios/OtterMail/Settings/Licenses.swift"]), true);
  assert.equal(ships("agents", ["apps/ios/OtterMail/Settings/General.swift"]), false);
});

test("what no app is built from ships nothing", () => {
  for (const file of [
    "docs/runbook.md",
    "changelog/0.13.51.md",
    "infra/relay/src/worker.ts",
    ".github/workflows/ci.yml",
    ".agents/skills/pr/SKILL.md",
  ]) {
    assert.deepEqual(release("auto", [file]), { desktop: false, iphone: false, agents: false });
  }
  assert.deepEqual(release("auto", []), { desktop: false, iphone: false, agents: false });
  // The notices are in the app; a script may be what packages it.
  assert.equal(ships("desktop", ["THIRD_PARTY_NOTICES.md"]), true);
  assert.equal(ships("desktop", ["scripts/build-desktop-artifact.ts"]), true);
});

test("with nothing to compare with, an app ships", () => {
  assert.deepEqual(release("auto", null), { desktop: true, iphone: true, agents: true });
  const neverReleased = (app: App) => (app === "agents" ? null : []);
  assert.deepEqual(plan({ channel: "nightly", apps: "auto", changed: neverReleased }), {
    desktop: false,
    iphone: false,
    agents: true,
  });
});

test("naming apps ships them whatever changed", () => {
  assert.deepEqual(release("iphone", []), { desktop: false, iphone: true, agents: false });
  assert.deepEqual(release("desktop", ["docs/runbook.md"]), {
    desktop: true,
    iphone: false,
    agents: false,
  });
  assert.deepEqual(release("all", []), { desktop: true, iphone: true, agents: true });
  assert.throws(() => release("android", []), /Unknown apps/);
});

test("an exact version is one release's", () => {
  const versioned = (apps: string, channel: "nightly" | "stable") =>
    plan({ channel, apps, version: "1.0.0", changed: () => ["apps/ios/OtterMail/App.swift"] });
  assert.equal(versioned("iphone", "nightly").iphone, true);
  assert.equal(versioned("agents", "nightly").agents, true);
  assert.equal(versioned("auto", "stable").desktop, true);
  for (const apps of ["auto", "all", "desktop"]) {
    assert.throws(() => versioned(apps, "nightly"), /names one release/);
  }
});

test("a stable release is the desktop app's alone", () => {
  const stable = { desktop: true, iphone: false, agents: false };
  assert.deepEqual(release("auto", ["apps/ios/OtterMail/App.swift"], "stable"), stable);
  assert.deepEqual(release("desktop", [], "stable"), stable);
  assert.throws(() => release("iphone", [], "stable"), /stable release/);
  assert.throws(() => release("all", [], "stable"), /stable release/);
});
