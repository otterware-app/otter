import { ipc } from "@otter/web/extension-kit";
import type { ProvidersState } from "@otter/web/extension-kit";

export const varysApi = {
  connectVarys: (
    params: { link: string } | { address: string; code: string },
  ): Promise<ProvidersState> => ipc("agent:connectVarys", params),

  /** `notice`: disconnected here, but varys still has the grant. */
  disconnectVarys: (): Promise<{ state: ProvidersState; notice?: string }> =>
    ipc("agent:disconnectVarys"),

  /** Gives varys Otter's relay, when that didn't happen on connecting. */
  varysRelay: (): Promise<ProvidersState> => ipc("agent:varysRelay"),
};
