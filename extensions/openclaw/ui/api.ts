import { ipc } from "@otter-mail/web/extension-kit";
import type { ProvidersState } from "@otter-mail/web/extension-kit";

export const openClawApi = {
  connectOpenClaw: (
    params: { code: string } | { url: string; token: string },
  ): Promise<ProvidersState> => ipc("agent:connectOpenClaw", params),

  agentAllowOpenClawFullAccess: (): Promise<ProvidersState> => ipc("agent:allowOpenClawFullAccess"),
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
