import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/rpc";

import type { OutlookSignInResult } from "./relay.js";

/**
 * A value carried as it is: the port between a host and core copies it
 * (structured clone), so bytes, dates and `undefined` arrive unchanged
 * instead of going through JSON.
 */
export const Cloned = Schema.declare((_value: unknown): _value is unknown => true, {
  expected: "a structured-clone value",
  toCodecJson: () => undefined,
});

export const Bytes = Schema.instanceOf(Uint8Array<ArrayBufferLike>, {
  toCodecJson: () => undefined,
});

export const PickedFile = Schema.Struct({
  name: Schema.String,
  mimeType: Schema.String,
  bytes: Bytes,
});
export type PickedFile = typeof PickedFile.Type;

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

export type GoogleSignInResult = {
  email: string;
  name: string;
  picture: string | null;
  sealed: string;
  accessToken: string;
  expiresIn: number;
};

const OpenTarget = Schema.Struct({
  accountId: Schema.String,
  messageId: Schema.String,
  mailbox: Schema.optional(Schema.String),
});

/**
 * What core asks of the app hosting it and waits for. Each host answers the
 * ones it has: the desktop app seals with the Keychain and shows dialogs; the
 * web app signs in through popups and translates in the browser.
 */
export const HostRequest = Schema.Union([
  Schema.TaggedStruct("seal", { text: Schema.String }),
  Schema.TaggedStruct("unseal", { sealed: Schema.String }),
  Schema.TaggedStruct("openExternal", { url: Schema.String }),
  Schema.TaggedStruct("openFile", { name: Schema.String, bytes: Bytes }),
  Schema.TaggedStruct("saveFile", { name: Schema.String, bytes: Bytes }),
  Schema.TaggedStruct("pickFiles", {}),
  Schema.TaggedStruct("todoistSignIn", {
    url: Schema.optional(Schema.String),
    close: Schema.optional(Schema.Boolean),
  }),
  Schema.TaggedStruct("googleSignIn", { loginHint: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("outlookSignIn", { loginHint: Schema.optional(Schema.String) }),
  Schema.TaggedStruct("detectLanguage", { text: Schema.String }),
  Schema.TaggedStruct("translate", {
    texts: Schema.Array(Schema.String),
    source: Schema.String,
    target: Schema.String,
  }),
]);
export type HostRequest = typeof HostRequest.Type;
export type HostRequestKind = HostRequest["_tag"];
export type HostRequestOf<K extends HostRequestKind> = Extract<HostRequest, { _tag: K }>;
/** `_tag` aside: what a request carries. */
export type HostRequestParams<K extends HostRequestKind> = Omit<HostRequestOf<K>, "_tag">;

export type HostRequestResults = {
  /** `text` encrypted with the Keychain's key, as base64. */
  seal: string;
  unseal: string;
  openExternal: void;
  openFile: void;
  saveFile: boolean;
  pickFiles: PickedFile[];
  todoistSignIn: string;
  googleSignIn: GoogleSignInResult;
  outlookSignIn: OutlookSignInResult;
  detectLanguage: LanguageDetection;
  translate: TranslationResult;
};

export const LogLevel = Schema.Literals(["debug", "info", "warn", "error"]);

/** What core tells its host without waiting for an answer. */
export const HostEffect = Schema.Union([
  Schema.TaggedStruct("notify", {
    title: Schema.String,
    subtitle: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String),
    open: Schema.optional(OpenTarget),
    code: Schema.optional(Schema.String),
  }),
  Schema.TaggedStruct("badge", { count: Schema.Number }),
  Schema.TaggedStruct("download", { name: Schema.String, bytes: Bytes }),
  Schema.TaggedStruct("open", { name: Schema.String, bytes: Bytes }),
  /** `settings`: core's AppSettings after a change; `patch`: what changed. */
  Schema.TaggedStruct("settings", { settings: Cloned, patch: Cloned }),
  /** A line for the host's log file. */
  Schema.TaggedStruct("log", {
    level: LogLevel,
    scope: Schema.String,
    message: Schema.String,
    data: Schema.optional(Schema.String),
  }),
  /** For the host's error reports (Sentry): `error` is a SerializedError. */
  Schema.TaggedStruct("report", {
    level: LogLevel,
    scope: Schema.String,
    message: Schema.String,
    error: Schema.optional(Cloned),
    tags: Schema.optional(Cloned),
  }),
]);
export type HostEffect = typeof HostEffect.Type;

export const HostMessage = Schema.Union([
  Schema.TaggedStruct("request", { id: Schema.Number, request: HostRequest }),
  Schema.TaggedStruct("effect", { effect: HostEffect }),
]);
export type HostMessage = typeof HostMessage.Type;

/** A `broadcast(channel, params)` from core's handlers. */
export const CoreEvent = Schema.Struct({ channel: Schema.String, params: Cloned });
export type CoreEvent = typeof CoreEvent.Type;

export class CoreStartError extends Schema.TaggedError<CoreStartError>()("CoreStartError", {
  message: Schema.String,
}) {}

/** A handler's failure; `message` is what the UI shows (as `ipc` errors today). */
export class CoreInvokeError extends Schema.TaggedError<CoreInvokeError>()("CoreInvokeError", {
  channel: Schema.String,
  message: Schema.String,
}) {}

export const CORE_RPC = {
  ready: "core.ready",
  invoke: "core.invoke",
  events: "core.events",
  host: "core.host",
  reply: "core.reply",
  resume: "core.resume",
  shutdown: "core.shutdown",
} as const;

/** Core started: the channels its handlers answer. */
export const CoreReadyRpc = Rpc.make(CORE_RPC.ready, {
  success: Schema.Struct({ channels: Schema.Array(Schema.String) }),
  error: CoreStartError,
});

/** `window.desktopBridge.invoke(channel, params)`, answered by core's `handle(channel, …)`. */
export const CoreInvokeRpc = Rpc.make(CORE_RPC.invoke, {
  payload: { channel: Schema.String, params: Cloned },
  success: Cloned,
  error: CoreInvokeError,
});

/** Core's broadcasts, in order; held until the host subscribes. */
export const CoreEventsRpc = Rpc.make(CORE_RPC.events, { success: CoreEvent, stream: true });

/** Core's requests and effects for its host; each request is answered with `core.reply`. */
export const CoreHostRpc = Rpc.make(CORE_RPC.host, { success: HostMessage, stream: true });

export const CoreReplyRpc = Rpc.make(CORE_RPC.reply, {
  payload: {
    id: Schema.Number,
    result: Schema.optional(Cloned),
    error: Schema.optional(Schema.String),
  },
});

/** The computer woke or came back online: core resyncs. */
export const CoreResumeRpc = Rpc.make(CORE_RPC.resume);

/** Stops core's providers before the host ends it. */
export const CoreShutdownRpc = Rpc.make(CORE_RPC.shutdown);

/**
 * The protocol between core and the app that hosts it (Electron's main
 * process, the web app's hosting tab, the phone): core is the server, in a
 * utility process, a Web Worker or the phone's worker runtime.
 */
export class CoreHostRpcs extends RpcGroup.make(
  CoreReadyRpc,
  CoreInvokeRpc,
  CoreEventsRpc,
  CoreHostRpc,
  CoreReplyRpc,
  CoreResumeRpc,
  CoreShutdownRpc,
) {}
