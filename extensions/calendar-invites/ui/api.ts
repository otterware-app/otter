/** Calendar invites' calls (core: calendar:getInvite, calendar:respond). */

import { task } from "@otter-mail/web/extension-kit";

export type RsvpResponse = "accepted" | "declined" | "tentative";

/** A calendar invitation found in a message (from its .ics). */
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
  /** False: this account hasn't granted calendar access (replies go by email). */
  calendarAccess: boolean;
  htmlLink: string | null;
  cancelled: boolean;
};

export const invitesApi = {
  /** The calendar invitation in a message, with your current answer (null: none). */
  getCalendarInvite: (accountId: string, messageId: string): Promise<CalendarInvite | null> =>
    task("calendar:getInvite", { accountId, messageId }),

  /** RSVP to an invitation (Calendar API, or an email reply to the organizer). */
  respondToInvite: (
    accountId: string,
    messageId: string,
    response: RsvpResponse,
  ): Promise<CalendarInvite | null> => task("calendar:respond", { accountId, messageId, response }),
};
