import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion, nightlyReleaseMetadata } from "./resolve-release-version.ts";
import { createBuildConfig, resolvePublishConfig } from "./build-desktop-artifact.ts";
import { versionMatchesChannel } from "../packages/shared/src/release-channel.ts";
import { iosCommitSpec, iosSentryRelease, previousIosTag } from "./sentry-release-ios.ts";

const nightly = "0.13.10-nightly.20261013.123";

test("nightlies preview the next stable patch without changing the stable source version", () => {
  assert.deepEqual(nightlyReleaseMetadata("0.13.9", "20261013", "123", "abcdef1234567890"), {
    version: nightly,
    tag: `v${nightly}`,
    name: `Otter Nightly ${nightly} (abcdef123456)`,
  });
  assert.equal(bumpVersion("ios-v0.8.9", "minor"), "0.9.0");
  assert.equal(bumpVersion("ios-agents-v0.1.0", "patch"), "0.1.1");
  for (const [date, run, sha] of [
    ["2026-10-13", "123", "abcdef123"],
    ["20261013", "0", "abcdef123"],
    ["20261013", "123", "HEAD"],
  ]) {
    assert.throws(() => nightlyReleaseMetadata("0.13.9", date!, run!, sha!));
  }
});

test("stable and nightly feeds are separate, while other prereleases have no update feed", () => {
  assert.deepEqual(resolvePublishConfig("0.13.9", {}), {
    provider: "github",
    owner: "otterware-app",
    repo: "otter",
    releaseType: "release",
    channel: "latest",
  });
  assert.deepEqual(resolvePublishConfig(nightly, {}), {
    provider: "github",
    owner: "otterware-app",
    repo: "otter",
    releaseType: "prerelease",
    channel: "nightly",
  });
  assert.deepEqual(resolvePublishConfig(nightly, { OTTER_UPDATE_URL: "http://localhost:8791" }), {
    provider: "generic",
    url: "http://localhost:8791",
    channel: "nightly",
  });
  assert.equal(resolvePublishConfig("0.13.10-rc.1", {}), undefined);
  assert.throws(() => resolvePublishConfig(nightly, { OTTER_UPDATE_REPOSITORY: "bad/repo/path" }));
  assert.equal(versionMatchesChannel(nightly, "stable"), false);
  assert.equal(versionMatchesChannel("0.13.9", "nightly"), false);
  assert.equal(versionMatchesChannel("0.13.10-rc.1", "stable"), false);
});

test("packaged icons follow the build, with no user icon collection or cross-channel manifests", () => {
  for (const platform of ["mac", "linux"] as const) {
    for (const version of ["0.13.9", nightly]) {
      const config = createBuildConfig({
        platform,
        version,
        target: platform === "mac" ? "dmg" : "deb",
        signed: false,
        electronVersion: "44.4.2",
        entitlementsPath: undefined,
        env: {},
      });
      const icon = version === nightly ? "icon-nightly" : "icon";
      assert.equal((config.mac as { icon: string }).icon, `${icon}.icns`);
      assert.equal((config.mac as { executableName: string }).executableName, "Otter Mail");
      assert.equal(
        (config.mac as { extendInfo: Record<string, unknown> }).extendInfo.CFBundleDisplayName,
        "Otter Mail",
      );
      assert.equal((config.linux as { icon: string }).icon, `${icon}.png`);
      assert.deepEqual(config.extraResources, [
        { from: `resources/${icon}.png`, to: `${icon}.png` },
      ]);
      assert.equal(config.generateUpdatesFilesForAllChannels, false);
      assert.equal(config.appId, "dev.otterware.mail");
    }
  }
});

test("signed Mac builds notarize through our hook, which retries stapling", () => {
  const build = (signed: boolean) =>
    createBuildConfig({
      platform: "mac",
      version: "0.13.9",
      target: "dmg",
      signed,
      electronVersion: "44.4.2",
      entitlementsPath: signed ? "/tmp/entitlements.mac.plist" : undefined,
      env: {},
    });
  const signed = build(true);
  assert.equal((signed.mac as { notarize: boolean }).notarize, false);
  assert.match(String(signed.afterSign), /scripts\/notarize-mac\.ts$/);
  assert.equal(build(false).afterSign, undefined);
});

test("the iPhone's Sentry release is the one the app reports, with commits since the last iPhone tag", () => {
  assert.equal(iosSentryRelease("0.8.4", "202611040931"), "otter-mail-ios@0.8.4+202611040931");
  for (const [version, build] of [
    ["0.8", "202611040931"],
    ["0.8.4", "1"],
    ["0.8.4", ""],
  ]) {
    assert.throws(() => iosSentryRelease(version!, build!));
  }

  const tags = ["v0.13.9", "ios-v0.8.10", "ios-v0.8.9", "ios-v0.8.4", "ios-v0.9.0", "ios-v1.0"];
  assert.equal(previousIosTag(tags, "0.8.11"), "ios-v0.8.10");
  assert.equal(previousIosTag(tags, "0.9.0"), "ios-v0.8.10");
  assert.equal(previousIosTag(tags, "0.8.4"), undefined);

  const [a, b] = ["a".repeat(40), "b".repeat(40)];
  assert.equal(iosCommitSpec("otterware-app/otter", a, b), `otterware-app/otter@${a}..${b}`);
  assert.throws(() => iosCommitSpec("otter-mail", a, b));
  assert.throws(() => iosCommitSpec("otterware-app/otter", "HEAD", b));
});
