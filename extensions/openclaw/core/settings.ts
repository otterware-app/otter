import type { AgentSettings } from "@otter/core/extension-kit";

export type OpenClawSettings = AgentSettings & {
  url: string;
  model: string;
  /** The gateway's agents turned off: none of their chats run, and new ones don't start on them. */
  disabledAgents: string[];
};

export const OPENCLAW_DEFAULTS: OpenClawSettings = {
  enabled: true,
  url: "",
  model: "",
  disabledAgents: [],
};
