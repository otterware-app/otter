export const GMAIL_SCOPES = [
  "https://mail.google.com/",
  "openid",
  "email",
  "profile",
  // People API, for sender avatars. Tokens issued before these scopes were
  // added simply 403 on People calls (the avatar cascade skips to Gravatar);
  // re-adding the account upgrades its consent in place.
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  // Calendar, for answering invitations in place: events on calendars the user
  // owns (the invitation's copy on their primary calendar). Tokens granted the
  // broader calendar.events before work the same; older tokens lack both: RSVP
  // then falls back to an email reply; re-adding the account upgrades it.
  "https://www.googleapis.com/auth/calendar.events.owned",
  // The calendar's list and every calendar on it (shared, followed: birthdays,
  // holidays), and teammates' availability. Older tokens see only the primary
  // calendar, and no teammates, until the mailbox signs in again.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];
