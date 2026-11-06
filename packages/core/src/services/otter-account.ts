import { createAuthClient } from "better-auth/client";

import type { OtterDevice } from "@otter-mail/contracts";
import type { MeResponse, RelayUser } from "@otter-mail/contracts/relay";

import { logger } from "../logger.js";
import { platform } from "../platform.js";

const SESSION_SECRET = "otter-session";

let session: { token: string | null; user: RelayUser } | null = null;
const listeners = new Set<() => void>();

export function onOtterAccountChange(listener: () => void): void {
  listeners.add(listener);
}

const usesCookie = () => platform().relaySession === "cookie";

async function setSession(next: typeof session): Promise<void> {
  session = next;
  if (!usesCookie()) {
    if (next) await platform().secrets.set(SESSION_SECRET, JSON.stringify(next));
    else await platform().secrets.delete(SESSION_SECRET);
  }
  for (const listener of listeners) listener();
}

export async function loadOtterAccount(): Promise<void> {
  let bareToken: string | null = null;
  try {
    if (usesCookie()) {
      const { user } = await request<MeResponse>("GET", "/v1/me");
      session = { token: null, user };
    } else {
      const saved = await platform().secrets.get(SESSION_SECRET);
      if (saved && !saved.startsWith("{")) bareToken = saved;
      else session = saved ? (JSON.parse(saved) as { token: string; user: RelayUser }) : null;
    }
  } catch {
    session = null;
  }
  if (bareToken) await adoptBareToken(bareToken);
  if (!usesCookie()) {
    void finishPendingSignOuts().catch((err: unknown) => {
      logger.failure("otter-account", "Couldn't finish pending sign-outs", err);
    });
  }
}

const ADOPT_RETRY_MS = 60_000;

/** The Swift iPhone app saved the session as its bare token; this asks the relay whose it is. */
async function adoptBareToken(token: string): Promise<void> {
  try {
    await signInWithSession(token);
  } catch (err) {
    if (err instanceof RelayError && err.status === 401) {
      await platform()
        .secrets.delete(SESSION_SECRET)
        .catch(() => {});
      return;
    }
    logger.warn("otter-account", "Couldn't check the saved session, retrying", {
      status: err instanceof RelayError ? err.status : null,
    });
    setTimeout(async () => {
      const saved = await platform()
        .secrets.get(SESSION_SECRET)
        .catch(() => null);
      if (saved === token && !session) await adoptBareToken(token);
    }, ADOPT_RETRY_MS);
  }
}

// Sessions the Swift iPhone app signed out of before the relay heard.
const PENDING_SIGN_OUTS_SECRET = "otter-pending-sign-outs";

async function finishPendingSignOuts(): Promise<void> {
  const saved = await platform()
    .secrets.get(PENDING_SIGN_OUTS_SECRET)
    .catch(() => null);
  if (!saved) return;
  let pending: { token: string; origin: string }[] = [];
  try {
    pending = JSON.parse(saved) as typeof pending;
  } catch {}
  const left: typeof pending = [];
  for (const entry of pending) {
    const response = await fetch(`${entry.origin.replace(/\/$/, "")}/v1/auth/sign-out`, {
      method: "POST",
      credentials: "omit",
      headers: { Authorization: `Bearer ${entry.token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);
    if (!response || !(response.ok || response.status === 401)) left.push(entry);
  }
  if (left.length) await platform().secrets.set(PENDING_SIGN_OUTS_SECRET, JSON.stringify(left));
  else await platform().secrets.delete(PENDING_SIGN_OUTS_SECRET);
}

export function getOtterUser(): RelayUser | null {
  return session?.user ?? null;
}

export function getSessionToken(): string | null {
  return session?.token ?? null;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}

async function request<T>(
  method: string,
  route: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${platform().relayUrl}${route}`, {
      method,
      credentials: usesCookie() ? "include" : "omit",
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new RelayError(0, `Can't reach Otter Mail's servers (${String(err)}).`);
  }
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new RelayError(response.status, error || `The relay answered ${response.status}.`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export async function relayRequest<T = null>(
  method: string,
  route: string,
  body?: unknown,
): Promise<T> {
  const current = session;
  if (!current) throw new RelayError(401, "Not signed in to Otter Mail.");
  try {
    return await request<T>(method, route, { body, token: current.token });
  } catch (err) {
    if (err instanceof RelayError && err.status === 401 && session === current) {
      logger.warn("otter-account", "The relay ended this session; signing out");
      await setSession(null);
    }
    throw err;
  }
}

let authClient: ReturnType<typeof createClient> | null = null;

function createClient() {
  const { relayUrl, deviceName, appVersion } = platform();
  return createAuthClient({
    baseURL: relayUrl,
    basePath: "/v1/auth",
    fetchOptions: {
      credentials: usesCookie() ? "include" : "omit",
      auth: { type: "Bearer", token: () => session?.token ?? undefined },
      ...(deviceName
        ? {
            headers: {
              "User-Agent": `Otter Mail/${appVersion} (${encodeURIComponent(deviceName)})`,
            },
          }
        : {}),
    },
  });
}

const auth = () => (authClient ??= createClient());

async function unwrap<T>(
  call: Promise<
    { data: T; error: null } | { data: null; error: { status: number; message?: string } }
  >,
): Promise<T> {
  const { data, error } = await call;
  if (error) {
    if (error.status === 401 && session) await setSession(null);
    throw new RelayError(error.status, error.message || `The relay answered ${error.status}.`);
  }
  return data;
}

export async function signIn(idToken: string): Promise<RelayUser> {
  let token: string | null = null;
  const data = await unwrap(
    auth().signIn.social(
      { provider: "google", idToken: { token: idToken } },
      { onSuccess: (ctx) => void (token = ctx.response.headers.get("set-auth-token")) },
    ),
  );
  if (!data || !("user" in data) || (!token && !usesCookie())) {
    throw new RelayError(0, "The relay didn't return a session.");
  }
  const { user } = data;
  const relayUser: RelayUser = {
    id: user.id,
    email: user.email,
    name: user.name || null,
    picture: user.image ?? null,
  };
  await setSession({ token, user: relayUser });
  logger.info("otter-account", "Signed in", { user: user.email });
  return relayUser;
}

export async function signInWithSession(token: string): Promise<RelayUser> {
  const { user } = await request<MeResponse>("GET", "/v1/me", { token });
  await setSession({ token, user });
  return user;
}

export async function clearOtterSession(): Promise<void> {
  await setSession(null);
}

export async function signInRedirect(callbackURL: string): Promise<string> {
  const data = await unwrap(
    auth().signIn.social({ provider: "google", callbackURL, disableRedirect: true }),
  );
  if (!data || !("url" in data) || !data.url) throw new RelayError(0, "No sign-in URL.");
  return data.url;
}

export async function signOut(): Promise<void> {
  if (!session) return;
  await auth()
    .signOut()
    .catch((err: unknown) => {
      logger.failure("otter-account", "Couldn't end the relay session", err);
    });
  await setSession(null);
}

function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const mac = /^Otter Mail\/\S+ \((.+)\)$/.exec(ua)?.[1];
  if (mac) {
    try {
      return decodeURIComponent(mac);
    } catch {
      return mac;
    }
  }
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return browser ? `${browser} (web)` : "Unknown device";
}

export async function listDevices(): Promise<OtterDevice[]> {
  const [sessions, current] = await Promise.all([
    unwrap(auth().listSessions()),
    unwrap(auth().getSession()),
  ]);
  return (sessions ?? [])
    .map((s) => ({
      token: s.token,
      name: deviceName(s.userAgent),
      current: s.id === current?.session.id,
      lastActiveAt: new Date(s.updatedAt).getTime(),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt);
}

export async function signOutDevice(token: string): Promise<void> {
  await unwrap(auth().revokeSession({ token }));
}

export async function deleteOtterAccount(): Promise<void> {
  await unwrap(auth().deleteUser({}));
  await setSession(null);
}
