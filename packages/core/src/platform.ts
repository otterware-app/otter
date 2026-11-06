import type { MailAccount } from "./types.js";
import type { DemoGmailMailbox, DemoOutlookMailbox } from "@otter-mail/contracts/demo";
import type { SupportError } from "@otter-mail/shared/support";
import type { LanguageDetection, PickedFile, TranslationResult } from "@otter-mail/contracts/rpc";

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface SqlStatement {
  get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  all(...params: SqlValue[]): Record<string, SqlValue>[];
  run(...params: SqlValue[]): { changes: number | bigint };
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

export type FileInfo = { name: string; size: number; modifiedAt: number };

export type {
  LanguageDetection,
  PickedFile,
  TranslationResult,
  TranslationStatus,
} from "@otter-mail/contracts/rpc";

export interface GoogleAuth {
  /** Reads stored sign-ins; call once at startup so `isSignedIn` answers right away. */
  load(): Promise<void>;
  addAccount(loginHint?: string): Promise<MailAccount>;
  addDemoAccount?(mailbox: DemoGmailMailbox): Promise<MailAccount>;
  cancelSignIn(): void;
  isSignedIn(accountId: string): boolean;
  getAccessToken(accountId: string, opts?: { forceRefresh?: boolean }): Promise<string>;
  getIdToken(accountId: string): Promise<string>;
  signInForIdToken?(): Promise<string>;
  removeTokens(accountId: string): Promise<void>;
}

export type MicrosoftSignIn = { email: string; name: string };

/**
 * Outlook sign-in and tokens, per mailbox (keyed by its lowercased address):
 * Microsoft's OAuth with OUTLOOK_SCOPES. The desktop signs in itself
 * (loopback, PKCE); the web app through the relay, which seals the refresh
 * token. Microsoft rotates refresh tokens: each refresh stores the new one.
 */
export interface MicrosoftAuth {
  available(): Promise<boolean>;
  /** Reads stored sign-ins; call once at startup so `isSignedIn` answers right away. */
  load(): Promise<void>;
  addAccount(loginHint?: string): Promise<MicrosoftSignIn>;
  addDemoAccount?(mailbox: DemoOutlookMailbox): Promise<MicrosoftSignIn>;
  cancelSignIn(): void;
  isSignedIn(accountId: string): boolean;
  getAccessToken(accountId: string, opts?: { forceRefresh?: boolean }): Promise<string>;
  getIdToken(accountId: string): Promise<string>;
  removeTokens(accountId: string): Promise<void>;
}

/**
 * A TCP connection to a mail server (IMAP, SMTP), TLS already negotiated when
 * asked for. The desktop opens real sockets; the web app tunnels through the
 * relay (a WebSocket to `/v1/tunnel`) and does TLS itself, so the relay only
 * ever carries ciphertext.
 */
export interface ByteStream {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  startTls(): Promise<void>;
  close(): void;
}

export interface Translator {
  detect(text: string): Promise<LanguageDetection>;
  translate(texts: string[], source: string, target: string): Promise<TranslationResult>;
}

export interface AsyncContext<T> {
  run<R>(value: T, fn: () => R): R;
  get(): T | undefined;
}

/**
 * How much mail this device keeps and fetches on its own. The desktop app
 * keeps the most; a phone will keep less and sync only while it's open.
 */
export interface SyncPolicy {
  /** What a mailbox's first sync fills: the newest page of its inbox, or all of it. */
  initialCoverage: "inbox" | "mailbox";
  /** Older mail fills in by itself after that (else as lists page back). */
  automaticBackfill: boolean;
  /** Message bodies download ahead of being opened, to read offline. */
  bodyPrefetch: boolean;
  /** At most this many bytes of downloaded attachments are kept. */
  retentionBytes: number;
  /**
   * At most about this many bytes of cached mail are kept (bodies first, then
   * rows), the least recently opened first; drafts, scheduled and starred mail
   * always stay. Unset: everything stays.
   */
  cacheBytes?: number;
  /** When sync may run: whenever core does, or only while the app is in front. */
  execution: "background" | "foreground";
}

/** Where a notification's "turn on" sign-in returns to. */
export type NotificationReturn = "web" | "desktop" | "native";

export interface Platform {
  /** A label for support reports only: behaviour follows the capabilities below. */
  kind: "desktop" | "web" | "mobile";
  appVersion: string;
  errorReports?: boolean;
  supportDiagnostics?(): Promise<{ environment: string; errors?: SupportError[] }>;
  log(
    level: "debug" | "info" | "warn" | "error",
    scope: string,
    message: string,
    data?: unknown,
  ): void;

  database(): SqlDatabase;
  files: {
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, data: Uint8Array | string): Promise<void>;
    remove(path: string): Promise<void>;
    list(dir: string): Promise<FileInfo[]>;
  };
  secrets: {
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
    delete(name: string): Promise<void>;
  };
  userFiles: {
    open(name: string, bytes: Uint8Array): Promise<void>;
    save(name: string, bytes: Uint8Array): Promise<boolean>;
    pick(): Promise<PickedFile[]>;
  };

  google: GoogleAuth;
  microsoft?: MicrosoftAuth;
  /** Opens browser consent and returns its callback URL; the backend builds the PKCE URL. */
  todoistSignIn?: (authorize: (redirectUri: string) => Promise<string>) => Promise<string>;
  /**
   * Opens a connection to a mail server: TLS from the first byte with
   * `tls: true`, plain (to be upgraded with `startTls`) otherwise. Certificates
   * are verified against the system's (or a bundled) root store.
   */
  connect(host: string, port: number, opts: { tls: boolean }): Promise<ByteStream>;
  /**
   * `connect` opens real sockets (not the relay's tunnel), so a Gmail
   * mailbox's first sync can read every row over IMAP.
   */
  rawSockets: boolean;
  /** Fetches may read any origin (no CORS), as a mail domain's own autoconfig file needs. */
  crossOriginFetch: boolean;
  notificationReturn: NotificationReturn;
  syncPolicy: SyncPolicy;
  relayUrl: string;
  relaySession: "bearer" | "cookie";
  deviceName?: string;

  broadcast(channel: string, params?: unknown): void;
  notify(notification: {
    title: string;
    subtitle?: string;
    body?: string;
    /** `mailbox`: the alias mailbox to open it in. */
    open?: { accountId: string; messageId: string; mailbox?: string };
    code?: string;
  }): void;
  setUnreadCount(count: number): void;
  onResume(listener: () => void): () => void;
  asyncContext<T>(): AsyncContext<T>;
  translator?: Translator;
  agentServerUrl?: string;
}

/** Today's desktop and web policy: the whole mailbox, filling in by itself. */
export const KEEP_MAILBOX: Omit<SyncPolicy, "bodyPrefetch"> = {
  initialCoverage: "mailbox",
  automaticBackfill: true,
  retentionBytes: 512 * 1024 * 1024,
  execution: "background",
};

let current: Platform | null = null;

export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error("initCore() has not run.");
  return current;
}
