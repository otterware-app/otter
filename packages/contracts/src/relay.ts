export type SignInMethod = "google" | "microsoft" | "password";

export interface RelayUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  signInMethods?: SignInMethod[];
}

import type { ImapSettings, MailProviderKind } from "./mail.js";

export interface RelayAccount {
  email: string;
  provider: MailProviderKind;
  imap: ImapSettings | null;
  name: string | null;
  picture: string | null;
  displayName: string | null;
  color: string | null;
}

export const GMAIL_SIGN_IN_CANCELLED = "sign-in-cancelled";

export interface MeResponse {
  user: RelayUser;
  pushTopic: string;
  outlook?: boolean;
}

/** Microsoft rotates refresh tokens; replace the saved sealed token with each response's sealed value. */
export interface OutlookSignInResult {
  email: string;
  name: string;
  sealed: string;
  accessToken: string;
  expiresIn: number;
}

export interface OutlookTokenResponse {
  accessToken: string;
  expiresIn: number;
  idToken: string | null;
  sealed: string;
}

export interface OutlookWatchResponse {
  notificationUrl: string;
  clientState: string;
}

/** `PUT /v1/push/device`: replaces this authenticated session's iPhone registration.
 * Only already-linked Gmail mailboxes are accepted. No Gmail credentials or mail content.
 * `DELETE /v1/push/device` removes it. A token can belong to only one session per topic/environment.
 */
export interface PutPushDeviceRequest {
  token: string;
  topic: string;
  environment: "sandbox" | "production";
  mode: "off" | "inbox" | "all";
  mailboxes: string[];
}

export interface MailPushMetadata {
  version: 1;
  userId: string;
  email: string;
  historyId: string;
  mode: "inbox" | "all";
}

export interface NewMailPushMetadata {
  version: 2;
  userId: string;
  email: string;
  provider: "gmail" | "outlook" | "imap";
  historyId: string;
  messageId: string;
  /** IMAP needs the folder and UIDVALIDITY to address a message safely. */
  folder?: string;
  uidValidity?: number;
  mode: "inbox" | "all";
}

export interface NotificationConnection {
  email: string;
  provider: "gmail" | "outlook" | "imap";
  status: "connecting" | "ready" | "reauthorize" | "retry";
  updatedAt: number;
}

export interface AuthorizeNotificationConnectionResponse {
  url: string;
}

/**
 * `GET /v1/accounts?providers=gmail,imap`: the linked mailboxes of the
 * providers named. Without `providers` it lists Gmail accounts only: builds
 * from before IMAP take every row for a Gmail account. Unknown names are
 * ignored. `DELETE /v1/accounts/:email` takes the same parameter, and without
 * it unlinks only a Gmail account (an old build can't unlink an IMAP mailbox
 * it was never shown).
 */
export interface ListAccountsResponse {
  accounts: RelayAccount[];
}

/** Linking Gmail or Outlook requires an ID token for that address; updating an existing link does not.
 * Changing providers requires unlinking first. IMAP passwords stay on-device. */
export interface PutAccountRequest {
  idToken?: string;
  provider?: MailProviderKind;
  imap?: ImapSettings;
  name?: string | null;
  picture?: string | null;
  displayName?: string | null;
  color?: string | null;
}

export type Preferences = Record<string, unknown>;

export interface PreferencesResponse {
  preferences: Preferences;
  hermesKey: string | null;
}

export interface PutPreferencesRequest {
  preferences?: Preferences;
  hermesKey?: string | null;
}

/**
 * TCP tunnel protocol: wait for the text frame `open`, then exchange binary stream bytes.
 * Frame boundaries have no meaning; text frames after `open` close the tunnel.
 * TLS runs on the client inside the tunnel, including STARTTLS on plaintext mail ports.
 * Session and origin checks, mail-only ports, public destinations and transfer limits
 * prevent the tunnel from becoming an unauthenticated general-purpose proxy.
 */
export const TUNNEL_CLOSE = {
  connectFailed: 4502,
  lost: 4500,
  /** 30 minutes without a byte either way. */
  idle: 4408,
  rateLimited: 4429,
  limit: 4413,
  backlog: 4507,
} as const;

export type RelayEvent =
  | { type: "mail"; email: string; historyId: string }
  | { type: "accounts" }
  | { type: "preferences" }
  /**
   * Agent chats changed on another device (or this one): see chats.ts. `email`
   * is empty for builds before chats, which take an event they don't know for
   * a mailbox's: they find none and go on.
   */
  | { type: "chats"; email: "" };
