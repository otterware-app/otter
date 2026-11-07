/** Public-client OAuth: PKCE verifier and all credentials stay in the backend. */

import { platform, sha256 } from "@otter-mail/core/extension-kit";
const AUTH = "todoist-oauth";
const TOKEN = "todoist-token";
type Session = { clientId: string; accessToken: string; refreshToken?: string; expiresAt: number };
let refreshing: Promise<string> | undefined;
let signingIn = false;
let generation = 0;

async function oauth<T>(path: string, body: URLSearchParams | Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.todoist.com/oauth/${path}`, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type":
          body instanceof URLSearchParams
            ? "application/x-www-form-urlencoded"
            : "application/json",
      },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach Todoist for sign-in. Check your connection and try again.");
  }
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Too many Todoist sign-in attempts. Try again later."
        : "Todoist sign-in expired or was rejected. Please connect again.",
    );
  return response.json() as Promise<T>;
}
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

async function exchange(
  clientId: string,
  params: Record<string, string>,
  currentGeneration: number,
): Promise<string> {
  const result = await oauth<{ access_token: string; refresh_token?: string; expires_in?: number }>(
    "access_token",
    new URLSearchParams({ client_id: clientId, ...params }),
  );
  if (!result.access_token || (params.grant_type === "refresh_token" && !result.refresh_token)) {
    // A grace-window retry cannot recover the rotated refresh token: reconnect rather than replaying it.
    if (generation === currentGeneration && params.grant_type === "refresh_token")
      await clearTodoistOAuth();
    throw new Error("Please reconnect Todoist to renew your sign-in.");
  }
  if (generation !== currentGeneration)
    throw new Error("Todoist connection changed. Please try again.");
  const session: Session = {
    clientId,
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + (result.expires_in ?? 3600) * 1000,
  };
  await platform().secrets.set(AUTH, JSON.stringify(session));
  await platform().secrets.delete(TOKEN);
  return result.access_token;
}
export async function todoistAccessToken(rejectedToken?: string): Promise<string | null> {
  const saved = await platform().secrets.get(AUTH);
  if (!saved) return platform().secrets.get(TOKEN);
  const session = JSON.parse(saved) as Session;
  if (session.accessToken !== rejectedToken && session.expiresAt > Date.now() + 60000)
    return session.accessToken;
  if (!session.refreshToken)
    throw new Error("Your Todoist sign-in expired. Connect again in Settings → Integrations.");
  refreshing ??= exchange(
    session.clientId,
    { grant_type: "refresh_token", refresh_token: session.refreshToken },
    generation,
  ).finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export async function hasTodoistOAuth(): Promise<boolean> {
  return Boolean(await platform().secrets.get(AUTH));
}
export async function clearTodoistOAuth(): Promise<void> {
  generation++;
  await platform().secrets.delete(AUTH);
}

export async function signInTodoist(): Promise<void> {
  if (signingIn) throw new Error("A Todoist sign-in is already in progress.");
  const authorize = platform().todoistSignIn;
  if (!authorize) throw new Error("Todoist browser sign-in is not available here.");
  signingIn = true;
  const currentGeneration = generation;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(sha256(verifier));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  let clientId = "",
    redirectUri = "";
  try {
    const callback = new URL(
      await authorize(async (uri) => {
        redirectUri = uri;
        const saved = await platform().secrets.get("todoist-client");
        const client = saved
          ? (JSON.parse(saved) as { clientId: string; redirectUri: string })
          : null;
        if (client?.redirectUri === uri) clientId = client.clientId;
        else {
          const registered = await oauth<{ client_id: string }>("register", {
            client_name: "Otter Mail",
            client_uri: "https://mail.otterware.app",
            redirect_uris: [uri],
            scope: "data:read_write data:delete",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          });
          if (!registered.client_id)
            throw new Error("Todoist could not register this device. Try again.");
          clientId = registered.client_id;
          await platform().secrets.set(
            "todoist-client",
            JSON.stringify({ clientId, redirectUri: uri }),
          );
        }
        return `https://app.todoist.com/oauth/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: uri, scope: "data:read_write,data:delete", state, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" })}`;
      }),
    );
    if (
      callback.origin + callback.pathname !== redirectUri ||
      callback.searchParams.get("state") !== state
    )
      throw new Error("Todoist sign-in could not be verified. Try again.");
    const code = callback.searchParams.get("code");
    if (callback.searchParams.has("error") || !code)
      throw new Error("Todoist sign-in was cancelled or denied.");
    await exchange(
      clientId,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      },
      currentGeneration,
    );
  } finally {
    signingIn = false;
  }
}
