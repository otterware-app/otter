import { ipc } from "@otter-mail/web/extension-kit";
import type { OpenRouterConnection } from "@otter-mail/contracts/openrouter";
import type { ProvidersState } from "@otter-mail/web/extension-kit";

export const openRouterApi = {
  openrouterConnection: (): Promise<OpenRouterConnection> => ipc("agent:openrouterConnection"),

  connectOpenRouter: (apiKey: string): Promise<ProvidersState> =>
    ipc("agent:connectOpenRouter", { apiKey }),

  disconnectOpenRouter: (): Promise<ProvidersState> => ipc("agent:disconnectOpenRouter"),
};
