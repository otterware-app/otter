/**
 * The made-up relay: a pretend Otter account (the Personal mailbox's Robin), its preferences, its
 * mailboxes (whichever the app has) and its agents and chats (chats.ts's at first), kept in a file
 * of the app's own the way the relay keeps them (contracts' agent-sync.ts). Its realtime socket is
 * live and quiet. What it doesn't do answers 404.
 */
import {
  AGENT_SYNC_PAGE,
  applyMutation,
  prefixEnd,
  type AgentChange,
  type AgentStore,
  type AgentSyncRequest,
  type AgentSyncResponse,
} from "@otter/contracts/agent-sync";
import type {
  ListAccountsResponse,
  MeResponse,
  CalendarWatchResponse,
  OutlookWatchResponse,
  Preferences,
  RelayUser,
} from "@otter/contracts/relay";

import type { Platform } from "../platform.ts";
import * as accountStore from "../services/account-store.ts";
import type { MailAccount } from "../types.ts";
import { seedAgents } from "./chats.ts";

export const FAKE_RELAY_URL = "https://relay.demo.invalid";

export const DEMO_USER: RelayUser = {
  id: "demo-user",
  email: "demo@otter.example",
  name: "Robin Otter",
  picture: null,
};

const STATE_FILE = "demo-relay.json";
/** Seeds again when the seed changes. */
const STATE_VERSION = 1;

type State = {
  version: number;
  head: number;
  entries: Record<string, { value: unknown; version: number }>;
  clients: Record<string, number>;
  preferences: Preferences;
};

let state: State;
let files: Platform["files"];
let saving: ReturnType<typeof setTimeout> | null = null;

function save(): void {
  saving ??= setTimeout(() => {
    saving = null;
    void files.write(STATE_FILE, JSON.stringify(state));
  }, 200);
}

function store(): AgentStore {
  const keysIn = (prefix: string) =>
    Object.keys(state.entries).filter((key) => key >= prefix && key < prefixEnd(prefix));
  return {
    get: (key) => state.entries[key]?.value,
    set(key, value) {
      state.entries[key] = { value, version: ++state.head };
    },
    turnKeys: (chat) => keysIn(`turn/${chat}/`),
    removeTurns(chat) {
      for (const key of keysIn(`turn/${chat}/`)) delete state.entries[key];
    },
    deviceKeys: (agent) => keysIn(`agent-device/${agent}/`),
    secretKeys: (agent) => keysIn(`secret/${agent}/`),
  };
}

function sync(request: AgentSyncRequest): AgentSyncResponse {
  const last = state.clients[request.client] ?? 0;
  const agents = store();
  for (const { id, mutation } of request.mutations) {
    if (id > last) applyMutation(agents, mutation);
  }
  state.clients[request.client] = Math.max(last, ...request.mutations.map((m) => m.id));
  if (request.mutations.length > 0) save();
  const rows = Object.entries(state.entries)
    .filter(([, entry]) => entry.version > request.since)
    .sort(([, a], [, b]) => a.version - b.version);
  const page = rows.slice(0, AGENT_SYNC_PAGE);
  const changes: AgentChange[] = page.map(([key, { value }]) => ({ key, value }));
  const more = rows.length > page.length;
  return {
    version: more ? page.at(-1)![1].version : state.head,
    lastMutationId: state.clients[request.client]!,
    changes,
    more,
  };
}

const relayAccount = (account: MailAccount) => ({
  email: account.email,
  provider: account.provider ?? "gmail",
  imap: account.imap ?? null,
  name: account.name,
  picture: account.picture?.startsWith("data:") ? null : (account.picture ?? null),
  displayName: account.displayName ?? null,
  color: account.color ?? null,
  customPicture: account.customPicture ?? null,
  aliasPictures: account.aliasPictures ?? null,
});

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** The relay's answer to a request the app made of it. */
export async function answerRelay(url: URL, method: string, rawBody: unknown): Promise<Response> {
  const body = typeof rawBody === "string" && rawBody ? (JSON.parse(rawBody) as unknown) : {};
  const route = `${method} ${url.pathname}`;
  if (route === "GET /v1/me") {
    return json({
      user: DEMO_USER,
      pushTopic: "projects/otter-demo/topics/gmail",
    } satisfies MeResponse);
  }
  if (route === "GET /v1/preferences") return json({ preferences: state.preferences });
  if (route === "PUT /v1/preferences") {
    state.preferences = {
      ...state.preferences,
      ...(body as { preferences?: Preferences }).preferences,
    };
    save();
    return json(null, 204);
  }
  if (route === "GET /v1/accounts") {
    const accounts = (await accountStore.listAccounts()).map(relayAccount);
    return json({ accounts } satisfies ListAccountsResponse);
  }
  if (url.pathname.startsWith("/v1/accounts/") && (method === "PUT" || method === "DELETE")) {
    return json(null, 204);
  }
  if (route === "POST /v1/agent-sync") return json(sync(body as AgentSyncRequest));
  if (route === "POST /v1/outlook/watch") {
    return json({
      notificationUrl: `${FAKE_RELAY_URL}/v1/outlook/notify`,
      clientState: "demo",
    } satisfies OutlookWatchResponse);
  }
  if (route === "POST /v1/calendar/watch") {
    return json({
      notificationUrl: `${FAKE_RELAY_URL}/push/calendar`,
      token: "demo",
    } satisfies CalendarWatchResponse);
  }
  return json({ error: "The made-up relay doesn't do that." }, 404);
}

/** A realtime socket to the made-up relay: it opens, answers pings, and has nothing to say. */
class FakeRelaySocket extends EventTarget {
  readyState: number = WebSocket.CONNECTING;

  constructor() {
    super();
    setTimeout(() => {
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    }, 50);
  }

  send(data: string): void {
    if (data === "ping") {
      // An Event with `data`, as the close event has its code: React Native has no MessageEvent.
      setTimeout(
        () => this.dispatchEvent(Object.assign(new Event("message"), { data: "pong" })),
        20,
      );
    }
  }

  close(code = 1000): void {
    if (this.readyState >= WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}

export async function installFakeRelay(demoFiles: Platform["files"]): Promise<void> {
  files = demoFiles;
  const bytes = await files.read(STATE_FILE);
  const saved = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as State) : null;
  if (saved?.version === STATE_VERSION) {
    state = saved;
  } else {
    state = { version: STATE_VERSION, head: 0, entries: {}, clients: {}, preferences: {} };
    const agents = store();
    for (const mutation of seedAgents(Date.now())) applyMutation(agents, mutation);
    await files.write(STATE_FILE, JSON.stringify(state));
  }

  const RealWebSocket = globalThis.WebSocket;
  const realtime = `${FAKE_RELAY_URL.replace(/^http/, "ws")}/`;
  globalThis.WebSocket = new Proxy(RealWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      return String(args[0]).startsWith(realtime)
        ? new FakeRelaySocket()
        : Reflect.construct(target, args);
    },
  });
}
