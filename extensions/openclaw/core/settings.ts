import type { AgentSettings } from "@otter-mail/core/extension-kit";

export type OpenClawSettings = AgentSettings & {
  url: string;
  model: string;
};

export const OPENCLAW_DEFAULTS: OpenClawSettings = { enabled: true, url: "", model: "" };
