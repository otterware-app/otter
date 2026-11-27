import { createAuthClient } from "better-auth/client";

import type { OtterDevice } from "@otter/contracts";
import type { MeResponse, RelayUser } from "@otter/contracts/relay";

import { logger } from "../logger.ts";
import { platform } from "../platform.ts";

export const SESSION_SECRET = "otter-session";
const PENDING_SIGN_OUTS_SECRET = "otter-pending-sign-outs";

export const OTTER_SIGNED_OUT_MESSAGE = "Not signed in to Otter.";

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
  try {
    if (usesCookie()) {
      const { user } = await request<MeResponse>("GET", "/v1/me");
      session = { token: null, user };
    } else {
      const saved = await platform().secrets.get(SESSION_SECRET);
      if (saved && platform().kind === "mobile" && !saved.startsWith("{")) {
        // Swift Otter Agents stored only the bearer token. Look up its account before rewriting it.
        try {
          const { user } = await request<MeResponse>("GET", "/v1/me", { token: saved });
          await setSession({ token: saved, user });
        } catch (error) {
          if (error instanceof RelayError && error.status === 401) await setSession(null);
          else throw error;
        }
      } else {
        session = saved ? (JSON.parse(saved) as { token: string; user: RelayUser }) : null;
      }
    }
  } catch {
    session = null;
  }
  void endPendingSignOuts();
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
    throw new RelayError(0, `Can't reach Otter's servers (${String(err)}).`);
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
  if (!current) throw new RelayError(401, OTTER_SIGNED_OUT_MESSAGE);
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

function signedIn(): void {
  if (!session) throw new RelayError(401, OTTER_SIGNED_OUT_MESSAGE);
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
  const current = session;
  if (!current) return;
  if (platform().kind === "mobile" && current.token) {
    const { token } = current;
    await endPhoneSession(token).catch(async (err: unknown) => {
      logger.failure(
        "otter-account",
        "Couldn't end the relay session; retrying at next start",
        err,
      );
      await savePendingSignOuts([...(await pendingSignOuts()), token]);
    });
  } else {
    await auth()
      .signOut()
      .catch((err: unknown) => {
        logger.failure("otter-account", "Couldn't end the relay session", err);
      });
  }
  await setSession(null);
}

/**
 * A phone's session holds its APNs registration, so it is ended at the relay even when signing
 * out offline: the token is kept until the relay can be reached.
 */
async function endPhoneSession(token: string): Promise<void> {
  await request("DELETE", "/v1/push/device", { token }).catch(unlessUnreachable);
  await request("POST", "/v1/auth/sign-out", { token, body: {} }).catch(unlessUnreachable);
}

/** Any answer but an outage is final: a 401 means the session has already ended. */
function unlessUnreachable(err: unknown): void {
  if (!(err instanceof RelayError) || err.status === 0 || err.status >= 500) throw err;
}

async function pendingSignOuts(): Promise<string[]> {
  return JSON.parse((await platform().secrets.get(PENDING_SIGN_OUTS_SECRET)) ?? "[]") as string[];
}

async function savePendingSignOuts(tokens: string[]): Promise<void> {
  if (tokens.length) await platform().secrets.set(PENDING_SIGN_OUTS_SECRET, JSON.stringify(tokens));
  else await platform().secrets.delete(PENDING_SIGN_OUTS_SECRET);
}

async function endPendingSignOuts(): Promise<void> {
  if (platform().kind !== "mobile") return;
  try {
    const ended = new Set<string>();
    for (const token of await pendingSignOuts()) {
      await endPhoneSession(token).then(
        () => ended.add(token),
        () => {},
      );
    }
    if (ended.size)
      await savePendingSignOuts((await pendingSignOuts()).filter((token) => !ended.has(token)));
  } catch (err) {
    logger.failure("otter-account", "Couldn't end the sessions signed out offline", err);
  }
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
  signedIn();
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
  signedIn();
  await unwrap(auth().revokeSession({ token }));
}

export async function deleteOtterAccount(): Promise<void> {
  signedIn();
  await unwrap(auth().deleteUser({}));
  await setSession(null);
}
