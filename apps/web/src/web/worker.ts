/// <reference lib="webworker" />

import { parseDemoMailboxes } from "@otter-mail/contracts/demo";
import { addDemoMailboxes, callHandler, startCore, type Platform } from "@otter-mail/core";
import { serializeError } from "@otter-mail/shared/error-reports";

import { webExtensions } from "./extensions";
import { webPlatform, type Page } from "./platform";
import type { FromWorker, PageRequests, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const post = (message: FromWorker) => self.postMessage(message, []);

let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
const resumeListeners = new Set<() => void>();

const page: Page = {
  request<K extends keyof PageRequests>(kind: K, params: PageRequests[K]["params"]) {
    const id = nextRequestId++;
    post({ type: "request", id, kind, params });
    return new Promise<PageRequests[K]["result"]>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
  },
  effect: (effect) => post({ type: "effect", ...effect }),
  broadcast: (channel, params) => post({ type: "event", channel, params }),
  onResume(listener) {
    resumeListeners.add(listener);
    return () => resumeListeners.delete(listener);
  },
  report(level, scope, message, data) {
    if (level === "debug") return;
    const error = data instanceof Error ? data : (data as { error?: unknown } | null)?.error;
    post({ type: "report", level, scope, message, error: serializeError(error) });
  },
};

self.addEventListener("error", (event) =>
  page.report("error", "backend", event.message, event.error),
);
self.addEventListener("unhandledrejection", (event) =>
  page.report("error", "backend", "Unhandled rejection", event.reason),
);

async function invoke(id: number, channel: string, params: unknown): Promise<void> {
  post({ type: "result", id, ...(await callHandler(channel, params)) });
}

/**
 * `pnpm dev:demo`: this browser is signed in to the demo's Otter account (its
 * first mailbox's address) before core asks who's here, and its mailboxes are
 * added before the page asks for any.
 */
async function startDemo(platform: Platform): Promise<void> {
  const json = await (await fetch("/__dev/demo-mailboxes")).text();
  const email = parseDemoMailboxes(json)[0]?.email;
  const me = await fetch(`${platform.relayUrl}/v1/me`, { credentials: "include" });
  const signedIn = me.ok && ((await me.json()) as { user: { email: string } }).user.email === email;
  if (email && !signedIn) {
    const response = await fetch(`${platform.relayUrl}/v1/dev/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error(`The relay couldn't sign in ${email} (${response.status}).`);
  }
  await startCore(platform, webExtensions);
  await addDemoMailboxes(json).catch((err: unknown) => console.error("Demo mailboxes:", err));
}

const ready = webPlatform(page).then(
  __DEV_DEMO__ ? startDemo : (platform) => startCore(platform, webExtensions),
);

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "invoke") {
    void ready.then(() => invoke(message.id, message.channel, message.params));
  } else if (message.type === "reply") {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error !== undefined) request?.reject(new Error(message.error));
    else request?.resolve(message.result);
  } else if (message.type === "resume") {
    for (const listener of resumeListeners) listener();
  }
});

self.addEventListener("online", () => {
  for (const listener of resumeListeners) listener();
});

ready.then(
  () => post({ type: "ready" }),
  (err: unknown) => {
    page.report("error", "backend", "Core failed to start", err);
    post({ type: "failed", error: err instanceof Error ? err.message : String(err) });
  },
);
