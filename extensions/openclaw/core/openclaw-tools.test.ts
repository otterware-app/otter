import { describe, expect, it } from "vite-plus/test";
import { agentToolNames } from "@otter/core/extension-kit";
import manifest from "../gateway/openclaw.plugin.json" with { type: "json" };

describe("Otter's tools on an OpenClaw gateway", () => {
  it("are declared by the plugin, every one of them", () => {
    expect(manifest.contracts.tools.toSorted()).toEqual(agentToolNames().toSorted());
  });
});
