export const OUTLOOK_SCOPES = [
  "openid",
  "email",
  "profile",
  // A refresh token, so the mailbox stays signed in.
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/MailboxSettings.ReadWrite",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

export const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
