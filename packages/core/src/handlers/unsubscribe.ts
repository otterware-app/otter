/** Unsubscribe (List-Unsubscribe): what a message offers, and doing it. Doing it runs as a task. */

import { handle } from "../ipc.js";
import { getUnsubscribe, isUnsubscribed, unsubscribe } from "../services/unsubscribe.js";
import { runAsTask } from "./ipc-budget.js";

type Params = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function registerUnsubscribeHandlers(): void {
  handle("gmail:getUnsubscribe", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    const info = await getUnsubscribe(accountId, messageId);
    return info ? { ...info, unsubscribed: isUnsubscribed(accountId, str(p?.fromEmail)) } : null;
  });

  handle("gmail:unsubscribe", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    return runAsTask(str(p?.taskId) || undefined, () => unsubscribe(accountId, messageId));
  });
}
