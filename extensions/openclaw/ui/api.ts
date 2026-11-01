/** OpenClaw's pairing calls (core: agent:connectOpenClaw, agent:allowOpenClawQuestions). */

import { ipc } from "@otter-mail/web/extension-kit";
import type { ProvidersState } from "@otter-mail/web/extension-kit";

export const openClawApi = {
  connectOpenClaw: (
    params: { code: string } | { url: string; token: string },
  ): Promise<ProvidersState> => ipc("agent:connectOpenClaw", params),

  /** Asks the OpenClaw gateway to let this device answer the agent's questions. */
  agentAllowOpenClawQuestions: (): Promise<ProvidersState> => ipc("agent:allowOpenClawQuestions"),
};
