import type { AgentTraits } from "@otter/client/agents/agent-traits";

export const traits = {
  missing: { headline: "Not connected" },
  connectedAs: true,
  serverApprovals: true,
  mailReader: "gog",
  ownModelSettings: true,
  subAgents: true,
} satisfies AgentTraits;
