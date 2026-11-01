import type { AgentSettings, RuntimeMode } from "@otter-mail/core/extension-kit";

export type ClaudeSettings = AgentSettings & {
  /** Empty → `claude` on the login shell's PATH. */
  binaryPath: string;
  /** Empty → Claude's default config dir (CLAUDE_CONFIG_DIR). */
  homePath: string;
  /** Empty → Claude Code's default model. */
  model: string;
  /** Empty → the model's default effort. */
  reasoningEffort: string;
  /** "fast" → fast mode; empty / "default" → standard. */
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
