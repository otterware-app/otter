/// <reference lib="webworker" />

import { parseDemoMailboxes } from "@otter-mail/contracts/demo";
import { addDemoMailboxes, serveCore, startCore, type Platform } from "@otter-mail/core";
import { serializeError, type ReportTags } from "@otter-mail/shared/error-reports";

import { webExtensions } from "./extensions";
import { webPlatform, type Page } from "./platform";

declare const self: DedicatedWorkerGlobalScope;

const resumeListeners = new Set<() => void>();
const resume = () => {
  for (const listener of resumeListeners) listener();
};

let ready: Promise<void> = new Promise(() => {});
const host = serveCore(
  {
    post: (message) => self.postMessage(message, []),
    listen(listener) {
      const onMessage = (event: MessageEvent) => listener(event.data);
      self.addEventListener("message", onMessage);
      return () => self.removeEventListener("message", onMessage);
    },
  },
  { ready: () => ready, onResume: resume },
);

const page: Page = {
  request: (kind, params) => host.request(kind, params),
  effect: (effect) => host.effect(effect),
  broadcast: (channel, params) => host.broadcast(channel, params),
  onResume(listener) {
    resumeListeners.add(listener);
    return () => resumeListeners.delete(listener);
  },
  report(level, scope, message, data) {
    if (level === "debug") return;
    const wrapped = data as { error?: unknown; tags?: ReportTags } | null;
    const error = data instanceof Error ? data : wrapped?.error;
    const tags = data instanceof Error ? undefined : wrapped?.tags;
    host.effect({ _tag: "report", level, scope, message, error: serializeError(error), tags });
  },
};

self.addEventListener("error", (event) =>
  page.report("error", "backend", event.message, event.error),
);
self.addEventListener("unhandledrejection", (event) =>
  page.report("error", "backend", "Unhandled rejection", event.reason),
);

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

ready = webPlatform(page).then(
  __DEV_DEMO__ ? startDemo : (platform) => startCore(platform, webExtensions),
);
ready.catch((err: unknown) => page.report("error", "backend", "Core failed to start", err));

self.addEventListener("online", resume);
