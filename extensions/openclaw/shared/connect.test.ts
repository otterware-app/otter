import type { ProviderSnapshot } from "@otter/client/agents/api";
import { describe, expect, it } from "vite-plus/test";
import { gatewayAgentPatch } from "./connect";

const gateway = (disabledAgents: string[]): ProviderSnapshot => ({
  id: "gw",
  kind: "openclaw",
  name: "Gateway",
  avatar: null,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: 0,
  models: [],
  model: null,
  sessions: true,
  forks: false,
  titles: false,
  liveBrowser: false,
  otherSessions: false,
  settings: { enabled: true, model: "", disabledAgents },
});

describe("turning a gateway's agents on and off", () => {
  it("adds one to those off, or takes it out, leaving the others", () => {
    expect(gatewayAgentPatch(gateway([]), "research", false)).toEqual({
      gw: { disabledAgents: ["research"] },
    });
    expect(gatewayAgentPatch(gateway(["main", "research"]), "research", true)).toEqual({
      gw: { disabledAgents: ["main"] },
    });
  });
});
