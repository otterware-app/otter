// @ts-check
// What decides whether a change needs a new build or ships as an update (scripts/ios-runtime.ts).
// Expo's fingerprint leaves out what this app puts into its native project itself: the
// notification extension (@bacons/apple-targets) and the patches pnpm applies to native packages.

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [
    { type: "dir", filePath: "targets", reasons: ["appleTargets"] },
    { type: "dir", filePath: "../../patches", reasons: ["pnpmPatches"] },
  ],
};
