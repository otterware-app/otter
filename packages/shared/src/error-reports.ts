import {
  addBreadcrumb,
  captureException,
  captureMessage,
  getClient,
  startSpan,
  type Breadcrumb,
  type ErrorEvent,
  type Event,
  type Options,
  type TracesSamplerSamplingContext,
  type TransactionEvent,
} from "@sentry/core";

import { releaseChannel } from "./release-channel.ts";

export const SENTRY_DSN = {
  desktop:
    "https://bd8af1cc7fce6daa3a23c63604d1a00e@o4512364656459776.ingest.de.sentry.io/4512364728221776",
  web: "https://7f770b56a78c138844e07a6977df9b43@o4512364656459776.ingest.de.sentry.io/4512364729270352",
  relay:
    "https://e4aca7bd12ed2618a2512e44546ad947@o4512364656459776.ingest.de.sentry.io/4512364730581072",
  site: "https://45d34e7cd05cb6cc35869f8c60375764@o4512364656459776.ingest.de.sentry.io/4512499033309264",
  mail: "https://8ab23b52535e531f2b75f22d02dae47c@o4512364656459776.ingest.de.sentry.io/4512364735496272",
  agents:
    "https://9408f6131b91d434b3aa76802ad9fceb@o4512364656459776.ingest.de.sentry.io/4512499033505872",
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** What an error happened in: the kind of mailbox (`provider`, `server`), the agent (`agent`). */
export type ReportTags = Record<string, string>;

/** Who an event came from: the Otter account when signed in, else this install's report id. */
export type ReportUser = { id: string; email?: string; username?: string };

/** Every transaction is kept while Otter has few users; lower it when Sentry's quota says so. */
export const TRACES_SAMPLE_RATE = 1;
/** Handlers run many times a minute: a tenth of them is enough to see what's slow. */
const SAMPLE_RATE_BY_OP: Record<string, number> = { "ipc.handler": 0.1 };

export function reportEnvironment(version: string, release: boolean): string {
  return release ? releaseChannel(version) : "development";
}

export function errorReportOptions(opts: {
  dsn: string;
  version: string;
  release?: string;
  environment: string;
  tracesSampleRate?: number;
  allowed?: (event: Event) => boolean;
}): Options {
  return {
    dsn: opts.dsn || undefined,
    enabled: Boolean(opts.dsn),
    release: opts.release ?? `otter-mail@${opts.version}`,
    environment: opts.environment,
    sendClientReports: false,
    maxBreadcrumbs: 100,
    // Whole transactions, not streamed spans: only those pass through beforeSendTransaction.
    traceLifecycle: "static",
    tracesSampler: (context: TracesSamplerSamplingContext) =>
      context.inheritOrSampleWith(
        SAMPLE_RATE_BY_OP[String(context.attributes?.["sentry.op"])] ??
          opts.tracesSampleRate ??
          TRACES_SAMPLE_RATE,
      ),
    // Requests carry sign-in tokens in their headers, cookies and bodies: those stay out.
    dataCollection: {
      userInfo: true,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: (event: ErrorEvent) => {
      const scrubbed = scrubEvent(event);
      return !opts.allowed || opts.allowed(scrubbed) ? scrubbed : null;
    },
    // Traces follow the same choice, and their spans' URLs can hold tokens (an APNs device's).
    beforeSendTransaction: (event: TransactionEvent) => {
      const scrubbed = scrubEvent(event);
      return !opts.allowed || opts.allowed(scrubbed) ? scrubbed : null;
    },
  } as Options;
}

/** Send held events directly: recapturing them triggers Sentry's deduplication. */
export class ConsentGate {
  private enabled: boolean | undefined;
  private held: Event[] = [];

  constructor(
    private readonly send: (event: Event) => unknown = (event) => getClient()?.sendEvent(event),
  ) {}

  set(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    const held = this.held.splice(0);
    if (enabled) for (const event of held) this.send(event);
  }

  readonly allowed = (event: Event): boolean => {
    if (this.enabled === undefined && this.held.length < 20) this.held.push(event);
    return this.enabled === true;
  };
}

/** Secrets only: who and what are kept, a token would let whoever reads the event in. */
const SCRUBBED: [RegExp, string][] = [
  [/\b([Bb]earer|[Bb]asic)\s+[\w.~+/=-]+/g, "$1 [redacted]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]"],
  [/\bya29\.[\w.-]+|\b1\/\/[\w-]{20,}/g, "[token]"],
  // Query strings carry searches and codes; keep the address before them.
  [/(\b[a-z][\w+.-]*:\/\/[^\s?"'<>]*)\?[^\s"'<>#]*/gi, "$1"],
  [/[\w+=-]{48,}/g, "[redacted]"],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SCRUBBED) out = out.replace(pattern, replacement);
  return out.length > 2_000 ? `${out.slice(0, 2_000)}…` : out;
}

const DROPPED_KEYS = new Set(["vars", "cookies", "headers", "data", "query_string", "env"]);
const KEPT_KEYS = new Set([
  "release",
  "environment",
  "dist",
  "sdk",
  "event_id",
  "trace_id",
  "user",
]);

export function scrubEvent<E extends Event>(event: E): E {
  const scrubbed = scrubDeep(event, 0) as E;
  if (scrubbed.request) {
    scrubbed.request = scrubbed.request.url ? { url: scrubbed.request.url } : {};
  }
  return scrubbed;
}

function scrubDeep(value: unknown, depth: number): unknown {
  if (typeof value === "string") return scrubText(value);
  if (!value || typeof value !== "object" || depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    // A breadcrumb's or frame's `data` is ours to keep (scrubbed); a request's is its body.
    if (DROPPED_KEYS.has(key) && !(key === "data" && depth > 1)) continue;
    out[key] = KEPT_KEYS.has(key) ? item : scrubDeep(item, depth + 1);
  }
  return out;
}

/** The console repeats our own log lines, already breadcrumbs. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") return null;
  return scrubDeep(breadcrumb, 2) as Breadcrumb;
}

/** A span in the current trace; without a Sentry client it only runs `work`. */
export function measure<T>(
  name: string,
  op: string,
  work: () => T,
  attributes?: Record<string, string | number | boolean>,
): T {
  return startSpan({ name, op, attributes: { ...attributes, "sentry.op": op } }, work);
}

const reported = new Map<string, number>();
const REPEAT_MS = 10 * 60_000;

export function reportLog(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (level === "debug") return;
  const text = scrubText(message);
  if (level !== "error") {
    addBreadcrumb({ category: scope, message: text, level: level === "warn" ? "warning" : "info" });
    return;
  }
  const key = `${scope}\n${text}`;
  const now = Date.now();
  if (now - (reported.get(key) ?? -Infinity) < REPEAT_MS) return;
  if (reported.size > 500) reported.clear();
  reported.set(key, now);

  const tags = { ...tagsIn(data), scope };
  const error = errorIn(data);
  if (error) {
    captureException(error, { tags, contexts: { log: { message: text } } });
  } else {
    captureMessage(text, { level: "error", tags, fingerprint: [scope, text] });
  }
}

function tagsIn(data: unknown): ReportTags {
  const tags = data && typeof data === "object" && "tags" in data ? data.tags : null;
  if (!tags || typeof tags !== "object") return {};
  return Object.fromEntries(
    Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function errorIn(data: unknown): Error | null {
  const candidate =
    data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : data;
  if (candidate instanceof Error) return candidate;
  if (isSerializedError(candidate)) return deserializeError(candidate);
  return null;
}

export type SerializedError = { name: string; message: string; stack?: string };

export function serializeError(error: unknown): SerializedError | undefined {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return undefined;
}

function isSerializedError(value: unknown): value is SerializedError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SerializedError).name === "string" &&
    typeof (value as SerializedError).message === "string" &&
    typeof (value as SerializedError).stack === "string"
  );
}

function deserializeError(value: SerializedError): Error {
  const error = new Error(value.message);
  error.name = value.name;
  error.stack = value.stack;
  return error;
}
