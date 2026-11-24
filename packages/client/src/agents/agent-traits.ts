/** What a kind of agent says of itself to every app, beside what it draws (its extension's `shared/traits.ts`). */
export type AgentTraits = {
  /** Its status while it isn't there to use. */
  missing: { headline: string; detail?: string };
  connectedAs?: boolean;
  serverApprovals?: boolean;
  ownModelSettings?: boolean;
  /** Its models are the agents it runs (an OpenClaw gateway's): the agent picker lists each. */
  subAgents?: boolean;
  /** What the agent reads mail with, named in the line under the mail a message points to; Otter's tools when absent. */
  mailReader?: string;
};
