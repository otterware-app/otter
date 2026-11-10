import { runAsTask } from "@otter/core/extension-kit";
import type { ExtensionContext } from "@otter/core/extension-kit";
import {
  addInviteToCalendar,
  getInvite,
  respondToInvite,
  type RsvpResponse,
} from "./calendar-invites.js";

type Params = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function registerInviteHandlers(handle: ExtensionContext["handle"]): void {
  handle("calendar:getInvite", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    if (!accountId || !messageId) throw new Error("accountId and messageId are required.");
    return runAsTask(str(p?.taskId) || undefined, () => getInvite(accountId, messageId));
  });

  handle("calendar:respond", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    const response = str(p?.response) as RsvpResponse;
    if (!accountId || !messageId || !["accepted", "declined", "tentative"].includes(response))
      throw new Error("accountId, messageId and a valid response are required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      respondToInvite(accountId, messageId, response),
    );
  });

  handle("calendar:addInvite", async (params: unknown) => {
    const p = params as Params;
    const accountId = str(p?.accountId);
    const messageId = str(p?.messageId);
    const targetAccountId = str(p?.targetAccountId);
    if (!accountId || !messageId || !targetAccountId)
      throw new Error("accountId, messageId and targetAccountId are required.");
    return runAsTask(str(p?.taskId) || undefined, () =>
      addInviteToCalendar(accountId, messageId, {
        accountId: targetAccountId,
        calendarId: str(p?.calendarId) || undefined,
      }),
    );
  });
}
