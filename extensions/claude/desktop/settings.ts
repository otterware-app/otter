import type { AgentSettings, RuntimeMode } from "@otter-mail/core/extension-kit";

export type ClaudeSettings = AgentSettings & {
  binaryPath: string;
  homePath: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export const CLAUDE_DEFAULTS: ClaudeSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "full-access",
};
