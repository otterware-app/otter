// @ts-check
// What decides whether a change needs a new build or ships as an update (scripts/agents-runtime.ts).
// Expo's fingerprint leaves out what this app puts into its native project itself: the
// notification extension (@bacons/apple-targets), the agents' marks the notifications plugin
// copies into the asset catalog, react-native-enriched-markdown's build flags, and the patches
// pnpm applies to native packages.

const { "enriched-markdown": markdown } = require("./package.json");

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  extraSources: [
    { type: "dir", filePath: "targets", reasons: ["appleTargets"] },
    ...["AgentOpenClaw", "AgentHermes", "AgentVarys"].map((mark) => ({
      type: /** @type {const} */ ("dir"),
      filePath: `assets/${mark}.imageset`,
      reasons: ["agentNotificationMarks"],
    })),
    {
      type: "contents",
      id: "enrichedMarkdownFlags",
      contents: JSON.stringify(markdown),
      reasons: ["enrichedMarkdownFlags"],
    },
    { type: "dir", filePath: "../../patches", reasons: ["pnpmPatches"] },
  ],
};
