import { task } from "@otter-mail/web/extension-kit";

import type { CalendarInvite, RsvpResponse } from "../invite";

export type { CalendarInvite, RsvpResponse };

export const invitesApi = {
  getCalendarInvite: (accountId: string, messageId: string): Promise<CalendarInvite | null> =>
    task("calendar:getInvite", { accountId, messageId }),

  respondToInvite: (
    accountId: string,
    messageId: string,
    response: RsvpResponse,
  ): Promise<CalendarInvite | null> => task("calendar:respond", { accountId, messageId, response }),
};
