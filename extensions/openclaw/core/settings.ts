import type { AgentSettings } from "@otter-mail/core/extension-kit";

export type OpenClawSettings = AgentSettings & {
  /** The gateway's WebSocket, `wss://<machine>.<tailnet>.ts.net`. */
  url: string;
  /** The gateway agent new chats use; empty → its default agent. */
  model: string;
};

export const OPENCLAW_DEFAULTS: OpenClawSettings = { enabled: true, url: "", model: "" };
