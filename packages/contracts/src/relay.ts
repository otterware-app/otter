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
  customPicture: string | null;
  aliasPictures: AliasPictures | null;
}

// A chosen picture is an inline data URL, never a link, so no device fetches it from anywhere.
export const MAILBOX_PICTURE_MAX_LENGTH = 48_000;

export function isMailboxPicture(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAILBOX_PICTURE_MAX_LENGTH &&
    /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

/** An IMAP mailbox's alias mailboxes' pictures, by address lower-cased. */
export type AliasPictures = Record<string, string>;

// Kept with the mailbox's row on the relay, which has a size limit.
export const ALIAS_PICTURES_MAX = 16;

export function isAliasPictures(value: unknown): value is AliasPictures {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= ALIAS_PICTURES_MAX &&
    entries.every(
      ([address, picture]) =>
        address.length <= 320 &&
        address.includes("@") &&
        address === address.toLowerCase() &&
        isMailboxPicture(picture),
    )
  );
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
  customPicture?: string | null;
  aliasPictures?: AliasPictures | null;
}

export type Preferences = Record<string, unknown>;

/** Each agent's key that follows the account (a Hermes server's API key), by the agent's id. */
export type AgentKeys = Record<string, string>;

export interface PreferencesResponse {
  preferences: Preferences;
  agentKeys: AgentKeys | null;
}

export interface PutPreferencesRequest {
  preferences?: Preferences;
  agentKeys?: AgentKeys | null;
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
  | { type: "chats"; email: "" }
  /** An agent's gateway has something for the user: the device reads it from the gateway itself. */
  | { type: "agent"; email: ""; pointer: AgentPointer };

/**
 * What an agent's gateway tells the relay when it delivers something to Otter
 * (a message, a question, an approval): where to read it and, for an iPhone's alert as in
 * T3 Code, the chat's title and the agent's name; never what was said.
 * The relay passes it on to the account's devices and keeps nothing.
 * `finished`, a run that ended in one of Otter's chats, is only pushed to the iPhones: an app
 * that's open reads the run itself.
 */
export interface AgentPointer {
  /** The gateway's channel, one of the account's (`AgentChannel`). */
  channel: string;
  kind: "message" | "question" | "approval" | "finished";
  agentId: string;
  sessionKey: string | null;
  approvalId?: string;
  approvalKind?: "exec" | "plugin";
  resolved?: boolean;
  questionId?: string;
  title?: string;
  agentName?: string;
  at: number;
}

/** What a push to Otter Agents carries beside its alert: the chat a tap opens. */
export interface AgentPushMetadata {
  version: 1;
  kind: "agent";
  userId: string;
  pointer: Omit<AgentPointer, "channel" | "title" | "agentName">;
}

/**
 * What a device tells the relay over its events socket: the agent session on screen while its
 * window has focus, null once it isn't. Said again every `WATCHING_EVERY_MS`: a device that
 * stops saying it (asleep, gone) isn't looking after `WATCHING_FOR_MS`. A chat someone is looking
 * at isn't pushed to the account's iPhones.
 */
export interface WatchingMessage {
  type: "watching";
  session: string | null;
}
export const WATCHING_EVERY_MS = 30_000;
export const WATCHING_FOR_MS = 90_000;

/** A gateway allowed to send the account's devices pointers, with a token shown once. */
export interface AgentChannel {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}
