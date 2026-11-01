import type { AgentSettings, RuntimeMode } from "@otter-mail/core/extension-kit";

export type CodexSettings = AgentSettings & {
  /** Empty → `codex` on the login shell's PATH. */
  binaryPath: string;
  /** Empty → Codex's default (~/.codex). */
  homePath: string;
  /** Extra arguments after `codex app-server`. */
  launchArgs: string;
  /** Empty → the model Codex marks as default. */
  model: string;
  /** Empty → the model's default effort. */
  reasoningEffort: string;
  /** Empty / "default" → standard speed. */
  serviceTier: string;
  runtimeMode: RuntimeMode;
};

export const CODEX_DEFAULTS: CodexSettings = {
  enabled: true,
  binaryPath: "",
  homePath: "",
  launchArgs: "",
  model: "",
  reasoningEffort: "",
  serviceTier: "",
  runtimeMode: "full-access",
};
