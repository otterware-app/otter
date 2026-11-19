import { ipc } from "@otter/web/extension-kit";
import type { ProvidersState } from "@otter/web/extension-kit";

import type { OpenClawChange, OpenClawModels } from "../core/models";

export const openClawApi = {
  connectOpenClaw: (
    agent: string,
    params: { code: string } | { url: string; token: string },
  ): Promise<ProvidersState> => ipc("agent:connectOpenClaw", { ...params, agent }),

  agentAllowOpenClawFullAccess: (agent: string): Promise<ProvidersState> =>
    ipc("agent:allowOpenClawFullAccess", { agent }),

  agentAllowOpenClawOwner: (agent: string): Promise<ProvidersState> =>
    ipc("agent:allowOpenClawOwner", { agent }),

  models: (agent: string): Promise<OpenClawModels | null> => ipc("agent:openClawModels", { agent }),

  /** The gateway's defaults (`gatewayAgent` null), or its agent `gatewayAgent`. */
  change: (agent: string, gatewayAgent: string | null, change: OpenClawChange): Promise<void> =>
    ipc("agent:changeOpenClaw", { agent, gatewayAgent, change }),
};

export type AgentChannel = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export const channelApi = {
  list: (): Promise<{ channels: AgentChannel[]; relayUrl: string }> => ipc("agent:channels"),
  make: (label: string): Promise<{ channel: AgentChannel; token: string; relayUrl: string }> =>
    ipc("agent:makeChannel", { label }),
  remove: (id: string): Promise<{ ok: boolean }> => ipc("agent:deleteChannel", { id }),
};
