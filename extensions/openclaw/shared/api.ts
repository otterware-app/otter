import { ipc } from "@otter/client/bridge";
import type { ProvidersState } from "@otter/client/agents/api";

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
