import type { AgentSettings } from "@otter-mail/core/extension-kit";

export type HermesSettings = AgentSettings & {
  baseUrl: string;
  /** The agent's virtual model id from /v1/models (Responses API). */
  agentModel: string;
  /** Chosen `provider::model`; empty → the gateway's default model. */
  model: string;
  /** Empty → the gateway's configured default. */
  reasoningEffort: string;
  /** Empty / "default" → standard speed. */
  serviceTier: string;
  /** Whether the server exposes the native Sessions API (probed at connect). */
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
