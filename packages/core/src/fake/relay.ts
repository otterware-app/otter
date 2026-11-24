/**
 * The made-up relay: a pretend Otter account (the Personal mailbox's Robin), its preferences, its
 * mailboxes (whichever the app has) and its agents and chats (chats.ts's at first), kept in a file
 * of the app's own the way the relay keeps them (contracts' agent-sync.ts). Its realtime socket is
 * live and quiet. Signing out and in again (with no Google), the account's other devices and
 * deleting the account work while the app runs; it starts signed in again with the app. What it
 * doesn't do answers 404.
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

import { platform, type Platform } from "../platform.ts";
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

/** What the pretend Google answers when the Otter account signs in: the relay takes any. */
export const DEMO_ID_TOKEN = "demo-otter-id-token";
const SESSION_TOKEN = "demo";

const STATE_FILE = "demo-relay.json";
/** Seeds again when the seed changes. */
const STATE_VERSION = 3;

type State = {
  version: number;
  head: number;
  entries: Record<string, { value: unknown; version: number }>;
  clients: Record<string, number>;
  preferences: Preferences;
  /** Signed out of the Otter account: the web app's session (a cookie) stays out across reloads. */
  signedOut?: boolean;
};

let state: State;

const MINUTE = 60_000;
/** The account's sessions besides this device's: signed out one by one, back with the app. */
let otherDevices: { token: string; userAgent: string; updatedAt: number }[] = [];

function thisDevice() {
  const { deviceName, appVersion } = platform();
  return {
    token: SESSION_TOKEN,
    userAgent: deviceName
      ? `Otter Mail/${appVersion} (${encodeURIComponent(deviceName)})`
      : (globalThis.navigator?.userAgent ?? ""),
    updatedAt: Date.now(),
  };
}

const session = (device: { token: string; userAgent: string; updatedAt: number }) => ({
  id: `session-${device.token}`,
  userId: DEMO_USER.id,
  createdAt: new Date(device.updatedAt - 30 * 24 * 60 * MINUTE).toISOString(),
  expiresAt: new Date(device.updatedAt + 30 * 24 * 60 * MINUTE).toISOString(),
  ...device,
  updatedAt: new Date(device.updatedAt).toISOString(),
});

const authUser = {
  id: DEMO_USER.id,
  email: DEMO_USER.email,
  name: DEMO_USER.name,
  image: DEMO_USER.picture,
  emailVerified: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/** The Otter account's sign-in (better-auth's routes, as the relay serves them under /v1/auth). */
async function answerAuth(route: string, body: Record<string, unknown>): Promise<Response | null> {
  const signedIn = () => (state.signedOut ? json({ message: "Unauthorized" }, 401) : null);
  // Saved before it answers: the web app reloads as soon as it's signed out.
  const setSignedOut = (out: boolean) => {
    state.signedOut = out;
    return files.write(STATE_FILE, JSON.stringify(state));
  };
  switch (route) {
    case "POST /v1/auth/sign-in/social": {
      const idToken = (body.idToken as { token?: string } | undefined)?.token;
      if (idToken !== DEMO_ID_TOKEN) return json({ message: "Invalid ID token" }, 401);
      await setSignedOut(false);
      return new Response(
        JSON.stringify({ redirect: false, token: SESSION_TOKEN, user: authUser }),
        { headers: { "Content-Type": "application/json", "set-auth-token": SESSION_TOKEN } },
      );
    }
    case "POST /v1/auth/sign-out":
      await setSignedOut(true);
      return json({ success: true });
    case "GET /v1/auth/get-session":
      return signedIn() ?? json({ session: session(thisDevice()), user: authUser });
    case "GET /v1/auth/list-sessions":
      return signedIn() ?? json([thisDevice(), ...otherDevices].map(session));
    case "POST /v1/auth/revoke-session":
      otherDevices = otherDevices.filter((d) => d.token !== body.token);
      if (body.token === SESSION_TOKEN) await setSignedOut(true);
      return signedIn() ?? json({ status: true });
    case "POST /v1/auth/delete-user":
      await setSignedOut(true);
      return json({ success: true, message: "User deleted" });
    default:
      return null;
  }
}
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
  if (url.pathname.startsWith("/v1/auth/"))
    return (await answerAuth(route, body as Record<string, unknown>)) ?? json({}, 404);
  if (route === "GET /v1/me") {
    if (state.signedOut) return json({ error: "Not signed in." }, 401);
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
  if (route === "GET /v1/agent-channels") return json({ channels: [] });
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

/** The app keeps its session itself (not a cookie): it starts signed in again, so the relay does. */
export function startSignedIn(): void {
  state.signedOut = false;
}

export async function installFakeRelay(demoFiles: Platform["files"]): Promise<void> {
  files = demoFiles;
  otherDevices = [
    {
      token: "demo-mac",
      userAgent: `Otter Mail/0.13.53 (${encodeURIComponent("Robin's MacBook Pro")})`,
      updatedAt: Date.now() - 12 * MINUTE,
    },
    {
      token: "demo-iphone",
      userAgent: `Otter Mail/1.8.0 (${encodeURIComponent("Robin's iPhone")})`,
      updatedAt: Date.now() - 26 * 60 * MINUTE,
    },
  ];
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
