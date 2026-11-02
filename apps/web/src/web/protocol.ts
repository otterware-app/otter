import type { LogLevel, SerializedError } from "@otter-mail/shared/error-reports";
import type { OutlookSignInResult } from "@otter-mail/contracts/relay";
import type { LanguageDetection, PickedFile, TranslationResult } from "@otter-mail/core";

export type GoogleSignInResult = {
  email: string;
  name: string;
  picture: string | null;
  sealed: string;
  accessToken: string;
  expiresIn: number;
};

export { GMAIL_SIGN_IN_CANCELLED as SIGN_IN_CANCELLED } from "@otter-mail/contracts/relay";

export type PageRequests = {
  todoistSignIn: { params: { url?: string; close?: boolean }; result: string };
  pickFiles: { params: undefined; result: PickedFile[] };
  googleSignIn: { params: { loginHint?: string }; result: GoogleSignInResult };
  outlookSignIn: { params: { loginHint?: string }; result: OutlookSignInResult };
  detectLanguage: { params: { text: string }; result: LanguageDetection };
  translate: {
    params: { texts: string[]; source: string; target: string };
    result: TranslationResult;
  };
};

export type PageEffect =
  | {
      kind: "notify";
      title: string;
      subtitle?: string;
      body?: string;
      open?: { accountId: string; messageId: string };
    }
  | { kind: "badge"; count: number }
  | { kind: "download"; name: string; bytes: Uint8Array }
  | { kind: "open"; name: string; bytes: Uint8Array };

export type ToWorker =
  | { type: "invoke"; id: number; channel: string; params: unknown }
  | { type: "reply"; id: number; result?: unknown; error?: string }
  /** The tab came back (visible again, or back online): reconnect and catch up. */
  | { type: "resume" };

export type FromWorker =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "result"; id: number; result?: unknown; error?: string }
  | { type: "event"; channel: string; params: unknown }
  | {
      type: "request";
      id: number;
      kind: keyof PageRequests;
      params: PageRequests[keyof PageRequests]["params"];
    }
  | ({ type: "effect" } & PageEffect)
  | {
      type: "report";
      level: LogLevel;
      scope: string;
      message: string;
      error?: SerializedError;
    };
