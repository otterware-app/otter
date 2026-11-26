import type { MailAccount } from "./types.ts";
import type { DemoGmailMailbox, DemoOutlookMailbox } from "@otter/contracts/demo";
import type { SupportError } from "@otter/shared/support";

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

export type PickedFile = { name: string; mimeType: string; bytes: Uint8Array };

export interface GoogleAuth {
  /** The large fake mailbox runs without Gmail quota delays during benchmarks. */
  bypassGmailQuota?: (accountId: string) => boolean;
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

export type LanguageDetection = { language: string | null; confidence: number };

/**
 * `needsDownload`: the browser must download the language pack, which it
 * only does after a click. `notInstalled`: the Mac's languages must be
 * downloaded in System Settings.
 */
export type TranslationStatus =
  | "ok"
  | "notInstalled"
  | "needsDownload"
  | "unsupported"
  | "unavailable";

export type TranslationResult = { status: TranslationStatus; texts: string[] };

export interface Translator {
  detect(text: string): Promise<LanguageDetection>;
  translate(texts: string[], source: string, target: string): Promise<TranslationResult>;
}

export interface AsyncContext<T> {
  run<R>(value: T, fn: () => R): R;
  get(): T | undefined;
}

export interface Platform {
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
  relayUrl: string;
  relaySession: "bearer" | "cookie";
  deviceName?: string;

  broadcast(channel: string, params?: unknown): void;
  notify(notification: {
    id?: string;
    title: string;
    subtitle?: string;
    body?: string;
    /** Each module stacks apart in the OS's notification center, agents with their own sound. */
    category: "mail" | "agent" | "calendar";
    /** Data URL of the agent's avatar: the web shows it, and a Mac build entitled to it draws it in place of the app's icon. */
    icon?: string;
    /**
     * Who sent it, and the chat's name: a Mac build entitled to communication notifications posts it
     * as a message from them, as Messages does.
     */
    agent?: { id: string; name: string; emoji?: string; mark?: string; conversation?: string };
    silent?: boolean;
    /** `mailbox`: the alias mailbox to open it in. */
    open?: { accountId: string; messageId: string; mailbox?: string };
    /** The agent chat to open. */
    chat?: string;
    code?: string;
    /** Buttons (macOS); the one pressed goes to the window as `notification:action`, with `id` and `chat`. */
    actions?: string[];
    /** A text field's placeholder (macOS); what's typed goes to the window the same way. */
    reply?: string;
  }): void;
  dismissNotification?(match: { id?: string; chat?: string }): void;
  setUnreadCount(count: number): void;
  onResume(listener: () => void): () => void;
  /** Reports whether the user is actively using this computer (unlocked and not idle). */
  onPresence?(listener: (active: boolean) => void): () => void;
  asyncContext<T>(): AsyncContext<T>;
  offlineDownloads: boolean;
  translator?: Translator;
  /** The built-in browser the agents drive (the desktop app's): a command and its arguments. */
  browser?: { run(command: string, args: Record<string, unknown>): Promise<unknown> };
}

let current: Platform | null = null;

export function setPlatform(platform: Platform): void {
  current = platform;
}

export function platform(): Platform {
  if (!current) throw new Error("initCore() has not run.");
  return current;
}
