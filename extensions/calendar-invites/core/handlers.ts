/** Calendar invitations: read the invite and your answer, and RSVP. Slow calls run as tasks. */

import { runAsTask } from "@otter-mail/core/extension-kit";
import type { ExtensionContext } from "@otter-mail/core/extension-kit";
import { getInvite, respondToInvite, type RsvpResponse } from "./calendar-invites.js";

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
}
