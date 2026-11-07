/**
 * The connection to the mail backend, from any number of tabs. The backend
 * (core, in a Web Worker) runs once: in whichever tab holds the
 * "otter-mail:backend" Web Lock (its cache is SQLite on OPFS, which one tab
 * at a time can open). The other tabs reach it over a BroadcastChannel. When
 * the hosting tab closes, the lock passes to another tab, which starts the
 * backend on the same cache and says so; waiting tabs then carry on.
 *
 * What needs a page (a file picker, the Gmail sign-in popup, a download)
 * happens in the tab whose invoke asked for it; notifications show once,
 * from the hosting tab; the unread badge shows in every tab.
 */

import { connectCore } from "@otter-mail/client-runtime/connection";
import type { HostRequest } from "@otter-mail/contracts/rpc";
import { reportLog, type ReportTags, type SerializedError } from "@otter-mail/shared/error-reports";

import type { PageEffect, PageRequests } from "./protocol";

export type PageHandlers = {
  onEvent(channel: string, params: unknown): void;
  onRequest<K extends keyof PageRequests>(
    kind: K,
    params: PageRequests[K]["params"],
  ): Promise<PageRequests[K]["result"]>;
  onEffect(effect: PageEffect): void;
  onFailed(error: string): void;
};

const ORIGIN_CHANNELS: Record<keyof PageRequests | "download" | "open", string[]> = {
  todoistSignIn: ["todoist:signIn"],
  pickFiles: ["gmail:pickAttachments", "otterDrive:uploadPicked", "otterDrive:uploadVersion"],
  googleSignIn: ["gmail:addAccount"],
  outlookSignIn: ["gmail:addOutlookAccount"],
  download: ["gmail:getAttachment", "otterDrive:download"],
  open: ["gmail:openAttachment", "gmail:openComposeAttachment"],
  detectLanguage: ["translation:detect"],
  translate: ["translation:translate"],
};

type TabMessage =
  | { type: "invoke"; tab: string; id: number; channel: string; params: unknown }
  | { type: "result"; tab: string; id: number; result?: unknown; error?: string }
  | { type: "event"; channel: string; params: unknown }
  | { type: "request"; tab: string; id: number; request: HostRequest }
  | { type: "reply"; id: number; result?: unknown; error?: string }
  | { type: "effect"; tab: string; effect: PageEffect }
  | { type: "failed"; error: string }
  | { type: "resume" }
  | { type: "host"; host: string }
  | { type: "hello" };

const ALL_TABS = "*";
const NAME = __DEMO__ ? "otter-mail-demo" : __DEV_DEMO__ ? "otter-mail-dev-demo" : "otter-mail";

export function connectBackend(page: PageHandlers) {
  const tab = crypto.randomUUID();
  const channel = new BroadcastChannel(NAME);
  const toTabs = (message: TabMessage) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel has none
    channel.postMessage(message);
  let hosting: ((message: TabMessage) => void) | null = null;
  let host: string | null = null;

  let nextId = 1;
  const pending = new Map<
    number,
    {
      channel: string;
      params: unknown;
      sent: boolean;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  function receive(message: TabMessage): void {
    switch (message.type) {
      case "result": {
        if (message.tab !== tab) return;
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (message.error !== undefined) call?.reject(new Error(message.error));
        else call?.resolve(message.result);
        break;
      }
      case "event":
        page.onEvent(message.channel, message.params);
        break;
      case "request": {
        if (message.tab !== tab) return;
        const { _tag: kind, ...params } = message.request;
        void page.onRequest(kind as keyof PageRequests, params as never).then(
          (result) => send({ type: "reply", id: message.id, result }),
          (err: unknown) =>
            send({
              type: "reply",
              id: message.id,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
        break;
      }
      case "effect":
        if (message.tab === tab || message.tab === ALL_TABS) page.onEffect(message.effect);
        break;
      case "failed":
        page.onFailed(message.error);
        break;
      case "host":
        if (message.host === host) return;
        host = message.host;
        for (const [id, call] of pending) {
          if (call.sent) {
            // The previous host went away mid-call: don't risk doing it twice.
            pending.delete(id);
            call.reject(new Error("Otter Mail reconnected in another tab. Try again."));
          } else {
            call.sent = true;
            send({ type: "invoke", tab, id, channel: call.channel, params: call.params });
          }
        }
        break;
    }
  }

  function send(message: TabMessage): void {
    if (hosting) hosting(message);
    else toTabs(message);
  }

  channel.addEventListener("message", (event: MessageEvent<TabMessage>) => {
    if (hosting) hosting(event.data);
    else receive(event.data);
  });

  function startHosting(): void {
    host = null;
    const lastOrigin = new Map<string, string>();
    const replies = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    let nextRequestId = 1;

    function deliver(message: TabMessage & { tab?: string }): void {
      if (message.tab === undefined || message.tab === tab || message.tab === ALL_TABS) {
        receive(message);
      }
      if (message.tab !== tab) toTabs(message);
    }

    const originOf = (kind: keyof typeof ORIGIN_CHANNELS) =>
      ORIGIN_CHANNELS[kind].map((c) => lastOrigin.get(c)).find(Boolean) ?? tab;

    const core = connectCore(
      () => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        return {
          post: (message) => worker.postMessage(message, []),
          listen(listener) {
            const onMessage = (event: MessageEvent) => listener(event.data);
            worker.addEventListener("message", onMessage);
            return () => worker.removeEventListener("message", onMessage);
          },
        };
      },
      {
        onEvent: (channel, params) => deliver({ type: "event", channel, params, tab: ALL_TABS }),
        onRequest: (request) =>
          new Promise((resolve, reject) => {
            const id = nextRequestId++;
            replies.set(id, { resolve, reject });
            const origin = originOf(request._tag as keyof PageRequests);
            deliver({ type: "request", tab: origin, id, request });
          }),
        onEffect(effect) {
          if (effect._tag === "report") {
            const error = effect.error as SerializedError | undefined;
            const tags = effect.tags as ReportTags | undefined;
            reportLog(effect.level, effect.scope, effect.message, tags ? { error, tags } : error);
            return;
          }
          const pageEffect = effect as PageEffect;
          const target =
            pageEffect._tag === "badge"
              ? ALL_TABS
              : pageEffect._tag === "notify"
                ? tab
                : originOf(pageEffect._tag);
          deliver({ type: "effect", tab: target, effect: pageEffect });
        },
      },
    );
    core.ready().then(
      () => {
        toTabs({ type: "host", host: tab });
        receive({ type: "host", host: tab });
      },
      (err: unknown) =>
        deliver({
          type: "failed",
          error: err instanceof Error ? err.message : String(err),
          tab: ALL_TABS,
        }),
    );

    hosting = (message) => {
      if (message.type === "invoke") {
        const { tab: from, id } = message;
        lastOrigin.set(message.channel, from);
        core.invoke(message.channel, message.params).then(
          (result) => deliver({ type: "result", tab: from, id, result }),
          (err: unknown) =>
            deliver({
              type: "result",
              tab: from,
              id,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
      } else if (message.type === "reply") {
        const reply = replies.get(message.id);
        replies.delete(message.id);
        if (message.error !== undefined) reply?.reject(new Error(message.error));
        else reply?.resolve(message.result);
      } else if (message.type === "resume") {
        core.resume();
      } else if (message.type === "hello" && host === tab) {
        toTabs({ type: "host", host: tab });
      }
    };
  }

  const resetDemo = __DEMO__ && new URLSearchParams(location.search).has("reset-demo");
  if (resetDemo) history.replaceState(null, "", location.pathname + location.hash);
  void navigator.locks.request(`${NAME}:backend`, async () => {
    if (resetDemo) {
      const root = await navigator.storage.getDirectory();
      for (const name of [".otter-mail-demo", "demo-files"]) {
        await root.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
    startHosting();
    return new Promise<never>(() => {});
  });
  toTabs({ type: "hello" });

  return {
    invoke<T>(invokedChannel: string, params?: unknown): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          channel: invokedChannel,
          params,
          sent: host !== null,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        if (host !== null) send({ type: "invoke", tab, id, channel: invokedChannel, params });
      });
    },
    resume(): void {
      send({ type: "resume" });
    },
  };
}
