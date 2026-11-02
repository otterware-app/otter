import { ipc } from "@otter-mail/web/extension-kit";
import type { ProvidersState } from "@otter-mail/web/extension-kit";

export const openClawApi = {
  connectOpenClaw: (
    params: { code: string } | { url: string; token: string },
  ): Promise<ProvidersState> => ipc("agent:connectOpenClaw", params),

  agentAllowOpenClawQuestions: (): Promise<ProvidersState> => ipc("agent:allowOpenClawQuestions"),
};
