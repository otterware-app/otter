import {
  addBreadcrumb,
  captureException,
  captureMessage,
  getClient,
  type Breadcrumb,
  type ErrorEvent,
  type Event,
  type Options,
} from "@sentry/core";

import { releaseChannel } from "./release-channel.ts";

export const SENTRY_DSN = {
  desktop:
    "https://bd8af1cc7fce6daa3a23c63604d1a00e@o4512364656459776.ingest.de.sentry.io/4512364728221776",
  web: "https://7f770b56a78c138844e07a6977df9b43@o4512364656459776.ingest.de.sentry.io/4512364729270352",
  relay:
    "https://e4aca7bd12ed2618a2512e44546ad947@o4512364656459776.ingest.de.sentry.io/4512364730581072",
} as const;

export type LogLevel = "debug" | "info" | "warn" | "error";

export function reportEnvironment(version: string, release: boolean): string {
  return release ? releaseChannel(version) : "development";
}

export function errorReportOptions(opts: {
  dsn: string;
  version: string;
  release?: string;
  environment: string;
  allowed?: (event: ErrorEvent) => boolean;
}): Options {
  return {
    dsn: opts.dsn || undefined,
    enabled: Boolean(opts.dsn),
    release: opts.release ?? `otter-mail@${opts.version}`,
    environment: opts.environment,
    sendClientReports: false,
    maxBreadcrumbs: 50,
    dataCollection: {
      userInfo: false,
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
    beforeSend: (event) => {
      const scrubbed = scrubEvent(event);
      return !opts.allowed || opts.allowed(scrubbed) ? scrubbed : null;
    },
  } as Options;
}

/** Send held events directly: recapturing them triggers Sentry's deduplication. */
export class ConsentGate {
  private enabled: boolean | undefined;
  private held: ErrorEvent[] = [];

  constructor(
    private readonly send: (event: ErrorEvent) => unknown = (event) =>
      getClient()?.sendEvent(event),
  ) {}

  set(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    const held = this.held.splice(0);
    if (enabled) for (const event of held) this.send(event);
  }

  readonly allowed = (event: ErrorEvent): boolean => {
    if (this.enabled === undefined && this.held.length < 20) this.held.push(event);
    return this.enabled === true;
  };
}

// Ends in a letter: `otter-mail@0.13.23` is a release, not an address.
const EMAIL = /[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;
const SCRUBBED: [RegExp, string][] = [
  [new RegExp(`${EMAIL.source}(/[^\\s"'<>?#]*)?`, "gi"), "[email]"],
  [/\b([Bb]earer|[Bb]asic)\s+[\w.~+/=-]+/g, "$1 [redacted]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]"],
  [/\bya29\.[\w.-]+|\b1\/\/[\w-]{20,}/g, "[token]"],
  // Query strings carry searches and codes; keep the address before them.
  [/(\b[a-z][\w+.-]*:\/\/[^\s?"'<>]*)\?[^\s"'<>#]*/gi, "$1"],
  [/(\/Users\/|\/home\/|\\Users\\)[^/\\\s"']+/g, "$1[user]"],
  [/[\w+=-]{48,}/g, "[redacted]"],
];

export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SCRUBBED) out = out.replace(pattern, replacement);
  return out.length > 2_000 ? `${out.slice(0, 2_000)}…` : out;
}

const DROPPED_KEYS = new Set(["vars", "cookies", "headers", "data", "query_string", "env"]);
const KEPT_KEYS = new Set(["release", "environment", "dist", "sdk", "event_id", "trace_id"]);

export function scrubEvent<E extends Event>(event: E): E {
  const scrubbed = scrubDeep(event, 0) as E;
  if (scrubbed.request) {
    scrubbed.request = scrubbed.request.url ? { url: scrubbed.request.url } : {};
  }
  scrubbed.user = scrubbed.user?.id ? { id: scrubbed.user.id } : undefined;
  // Sentry otherwise places the sender by its IP address (a city) before it drops it.
  if (scrubbed.sdk) scrubbed.sdk = { ...scrubbed.sdk, settings: { infer_ip: "never" } };
  delete scrubbed.server_name;
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

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  const category = breadcrumb.category ?? "";
  if (category === "console" || category.startsWith("ui.")) return null;
  // Electron's own breadcrumbs name every page a window shows, the browser's tabs too:
  // keep our window's routes, never what was browsed.
  const url = breadcrumb.data?.url;
  if (category === "electron" && typeof url === "string" && !url.startsWith("ottermail:")) {
    breadcrumb = { ...breadcrumb, data: { ...breadcrumb.data, url: "[page]" } };
  }
  return scrubDeep(breadcrumb, 2) as Breadcrumb;
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

  const error = errorIn(data);
  if (error) {
    captureException(error, { tags: { scope }, contexts: { log: { message: text } } });
  } else {
    captureMessage(text, { level: "error", tags: { scope }, fingerprint: [scope, text] });
  }
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
