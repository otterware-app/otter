import { ipc } from "@otter-mail/web/extension-kit";
import type { ProvidersState } from "@otter-mail/web/extension-kit";

export const hermesApi = {
  connectHermes: (params: { baseUrl: string; apiKey: string }): Promise<ProvidersState> =>
    ipc("agent:connectHermes", params),
};
