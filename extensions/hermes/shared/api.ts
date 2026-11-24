import { ipc } from "@otter/client/bridge";
import type { ProvidersState } from "@otter/client/agents/api";

export const hermesApi = {
  connectHermes: (params: {
    agent: string;
    baseUrl: string;
    apiKey: string;
  }): Promise<ProvidersState> => ipc("agent:connectHermes", params),
};
