import type { AgentSettings, RuntimeMode } from "@otter-mail/core/extension-kit";

export type OpenRouterSettings = AgentSettings & {
  reasoningEffort: string;
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export const OPENROUTER_DEFAULTS: OpenRouterSettings = {
  enabled: true,
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "approval-required",
};
