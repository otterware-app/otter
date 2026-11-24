import { ipc } from "@otter/client/bridge";
import type { ProvidersState } from "@otter/client/agents/api";

export const varysApi = {
  connectVarys: (
    agent: string,
    params: { link: string } | { address: string; code: string },
  ): Promise<ProvidersState> => ipc("agent:connectVarys", { agent, ...params }),

  /** `notice`: disconnected here, but varys still has the grant. */
  disconnectVarys: (agent: string): Promise<{ state: ProvidersState; notice?: string }> =>
    ipc("agent:disconnectVarys", { agent }),

  /** Gives varys Otter's relay, when that didn't happen on connecting. */
  varysRelay: (agent: string): Promise<ProvidersState> => ipc("agent:varysRelay", { agent }),
};
