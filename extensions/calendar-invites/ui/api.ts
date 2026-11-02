import { task } from "@otter-mail/web/extension-kit";

export type RsvpResponse = "accepted" | "declined" | "tentative";

export type CalendarInvite = {
  uid: string;
  method: string;
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: { name: string; email: string } | null;
  sequence: number;
  response: RsvpResponse | "needsAction";
  calendarAccess: boolean;
  htmlLink: string | null;
  cancelled: boolean;
};

export const invitesApi = {
  getCalendarInvite: (accountId: string, messageId: string): Promise<CalendarInvite | null> =>
    task("calendar:getInvite", { accountId, messageId }),

  respondToInvite: (
    accountId: string,
    messageId: string,
    response: RsvpResponse,
  ): Promise<CalendarInvite | null> => task("calendar:respond", { accountId, messageId, response }),
};
