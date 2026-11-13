/**
 * One varys agent's connection: an SDK client for this device's grant, made when first needed.
 * It keeps a Live socket that follows threads, the inbox and routines as they change.
 */

import { connect, type Varys } from "@generalpursuit/varys";
import {
  logger,
  refreshProvider,
  type AgentContext,
  type AgentId,
} from "@otter/core/extension-kit";
import type { ResultAsync } from "neverthrow";

import type { VarysSettings } from "./settings.js";

/** The grant's token, in the agent's secrets. */
export const TOKEN = "token";

export type VarysConnection = {
  /** The client for this device's grant; null while it isn't paired. */
  client(settings: VarysSettings): Promise<Varys | null>;
  close(): void;
};

export function varysConnection(agent: AgentContext): VarysConnection {
  let current: { key: string; varys: Varys } | null = null;
  const close = () => {
    void current?.varys.close();
    current = null;
  };
  return {
    async client(settings) {
      const token = await agent.secrets.get(TOKEN);
      if (!settings.address || !settings.agentId || !token) return null;
      const key = JSON.stringify([settings.address, settings.agentId, token]);
      if (current?.key === key) return current.varys;
      close();
      const made = connect({
        address: settings.address,
        agentId: settings.agentId,
        token,
        onError: (error) => logger.info("agent", "varys failed", { error: String(error) }),
      });
      if (made.isErr()) throw new Error(made.error.message);
      current = { key, varys: made.value };
      followDefault(agent.id, made.value);
      return made.value;
    },
    close,
  };
}

/** The owner's default model moves on their own devices: the picker's mark moves with it. */
function followDefault(agent: AgentId, varys: Varys): void {
  let shown: string | undefined;
  varys.models.watchSettings((view) => {
    if (view.status !== "fresh") return;
    const now = JSON.stringify(view.value.defaults ?? null);
    if (shown !== undefined && shown !== now) void refreshProvider(agent);
    shown = now;
  });
}

/** What a call answered, or varys's own message as the error. */
export async function answered<T>(call: ResultAsync<T, { message: string }>): Promise<T> {
  const result = await call;
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}

/** A failure as the chat shows it: varys's own message. */
export const failed = (error: { message: string }) => `agent_error: ${error.message}`;
