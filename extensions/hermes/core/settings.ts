import type { AgentSettings } from "@otter-mail/core/extension-kit";

export type HermesSettings = AgentSettings & {
  baseUrl: string;
  agentModel: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  sessions?: boolean;
};

export const HERMES_DEFAULTS: HermesSettings = {
  enabled: true,
  baseUrl: "",
  agentModel: "hermes-agent",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
};
