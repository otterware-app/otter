import { ipc } from "@otter/web/extension-kit";
import type { ProvidersState } from "@otter/web/extension-kit";

export const hermesApi = {
  connectHermes: (params: {
    agent: string;
    baseUrl: string;
    apiKey: string;
  }): Promise<ProvidersState> => ipc("agent:connectHermes", params),
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
