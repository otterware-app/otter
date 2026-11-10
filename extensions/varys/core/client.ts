/**
 * This device's connection to varys: one SDK client for its grant, made when first needed. It
 * keeps a Live socket that follows threads, the inbox and routines as they change.
 */

import { connect, type Varys } from "@generalpursuit/varys";
import { logger, refreshProvider } from "@otter/core/extension-kit";
import type { ResultAsync } from "neverthrow";

import type { VarysSettings } from "./settings.js";
import { getVarysToken } from "./token.js";

let current: { key: string; varys: Varys } | null = null;

/** The client for this device's grant; null while it isn't paired. */
export async function varysClient(settings: VarysSettings): Promise<Varys | null> {
  const token = await getVarysToken();
  if (!settings.address || !settings.agentId || !token) return null;
  const key = JSON.stringify([settings.address, settings.agentId, token]);
  if (current?.key === key) return current.varys;
  closeVarys();
  const made = connect({
    address: settings.address,
    agentId: settings.agentId,
    token,
    onError: (error) => logger.info("agent", "varys failed", { error: String(error) }),
  });
  if (made.isErr()) throw new Error(made.error.message);
  current = { key, varys: made.value };
  followDefault(made.value);
  return made.value;
}

/** The owner's default model moves on their own devices: the picker's mark moves with it. */
function followDefault(varys: Varys): void {
  let shown: string | undefined;
  varys.models.watchSettings((view) => {
    if (view.status !== "fresh") return;
    const now = JSON.stringify(view.value.defaults ?? null);
    if (shown !== undefined && shown !== now) void refreshProvider("varys");
    shown = now;
  });
}

export function closeVarys(): void {
  void current?.varys.close();
  current = null;
}

/** What a call answered, or varys's own message as the error. */
export async function answered<T>(call: ResultAsync<T, { message: string }>): Promise<T> {
  const result = await call;
  if (result.isErr()) throw new Error(result.error.message);
  return result.value;
}

/** A failure as the chat shows it: varys's own message. */
export const failed = (error: { message: string }) => `agent_error: ${error.message}`;
