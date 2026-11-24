import type { AgentTraits } from "@otter/client/agents/agent-traits";

export const traits = {
  missing: { headline: "Not connected" },
  serverApprovals: true,
  mailReader: "your mail connection",
} satisfies AgentTraits;
