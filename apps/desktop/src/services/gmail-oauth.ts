import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";

import { GMAIL_SCOPES } from "@otter-mail/contracts";
import type { DemoGmailMailbox } from "@otter-mail/contracts/demo";
import {
  accountStore,
  broadcast,
  logger,
  SIGNED_OUT_MESSAGE,
  SignInCancelledError,
  type MailAccount,
  type GoogleAuth,
} from "@otter-mail/core";

import { signInPage } from "@otter-mail/shared/sign-in-page";

import { appInfo } from "../backend-protocol.js";
import { requestMain } from "../main-link.js";
import { getCredentials } from "./credentials-store.js";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// Web OAuth clients require this exact loopback redirect URI to be registered.
const LOOPBACK_PORT = 42813;
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

const SCOPES = GMAIL_SCOPES;

const IDENTITY_SCOPES = ["openid", "email", "profile"];

type StoredTokens = {
  /** The OAuth client that issued these tokens; Google only refreshes them for that client. */
  clientId?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
};

type TokenFile = { version: 1; accounts: Record<string, string> };

let storeCache: Map<string, StoredTokens> | null = null;
let storeLoad: Promise<Map<string, StoredTokens>> | null = null;
let storeWrite: Promise<void> = Promise.resolve();

function tokenFilePath(): string {
  return path.join(appInfo().stateDir, "google-tokens.json");
}

function loadStore(): Promise<Map<string, StoredTokens>> {
  return (storeLoad ??= readStore().then((store) => (storeCache = store)));
}

async function readStore(): Promise<Map<string, StoredTokens>> {
  const store = new Map<string, StoredTokens>();
  try {
    const file = JSON.parse(await fs.readFile(tokenFilePath(), "utf-8")) as TokenFile;
    const { clientId } = await getCredentials();
    for (const [accountId, sealed] of Object.entries(file.accounts ?? {})) {
      try {
        const plain = await requestMain("unseal", { sealed });
        const tokens = JSON.parse(plain) as StoredTokens;
        // Google only refreshes a grant for the client that issued it; another's needs a new sign-in.
        if (tokens.clientId === clientId) store.set(accountId, tokens);
      } catch (err) {
        logger.warn("oauth", "Couldn't load stored Google sign-in", {
          accountId,
          error: String(err),
        });
      }
    }
  } catch {
    // No tokens yet.
  }
  return store;
}

async function saveStore(): Promise<void> {
  const store = await loadStore();
  const accounts: Record<string, string> = {};
  for (const [accountId, tokens] of store) {
    accounts[accountId] = await requestMain("seal", { text: JSON.stringify(tokens) });
  }
  const body = JSON.stringify({ version: 1, accounts } satisfies TokenFile, null, 2);
  // Serialize writes so a slow one never lands after a newer one.
  storeWrite = storeWrite.then(async () => {
    const file = tokenFilePath();
    await fs.writeFile(`${file}.tmp`, body, { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  });
  await storeWrite;
}

const base64url = (buffer: Buffer) => buffer.toString("base64url");

class SignInExpiredError extends Error {
  constructor(detail: string) {
    super(`Google sign-in expired (${detail}). Sign in to this account again.`);
  }
}

type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = await getCredentials();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    const detail = json.error_description || json.error || `HTTP ${response.status}`;
    if (json.error === "invalid_grant") throw new SignInExpiredError(detail);
    throw new Error(`Google token request failed: ${detail}`);
  }
  return json;
}

function toStored(
  clientId: string,
  response: TokenResponse,
  previousRefreshToken?: string,
): StoredTokens {
  const refreshToken = response.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token. Sign in to this account again.");
  }
  return {
    clientId,
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    ...(response.scope ? { scope: response.scope } : {}),
  };
}

/** The sign-in waiting on the browser, if any. Only one runs at a time: they share the port. */
let pendingSignIn: { cancel: () => void; done: Promise<unknown> } | null = null;

function cancelSignIn(): void {
  pendingSignIn?.cancel();
}

/**
 * Runs the browser half of the flow and resolves with the authorization code.
 * Mail sign-ins ask for consent every time, so Google always returns a
 * refresh token; identity sign-ins only ask which account.
 */
async function authorizeInBrowser(opts: {
  purpose: "mail" | "identity";
  loginHint?: string;
}): Promise<{
  code: string;
  redirectUri: string;
  verifier: string;
}> {
  if (pendingSignIn) {
    pendingSignIn.cancel();
    await pendingSignIn.done;
  }
  const { clientId } = await getCredentials();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    const listen = (candidate: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        // Another app holds the fixed port: any port still works for Desktop clients.
        if (err.code === "EADDRINUSE" && candidate !== 0) listen(0);
        else reject(err);
      });
      server.listen(candidate, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : candidate);
      });
    };
    listen(LOOPBACK_PORT);
  });
  const redirectUri = `http://127.0.0.1:${port}`;

  let cancel = () => {};
  const waitForCode = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Google sign-in timed out. Try adding the account again.")),
      AUTHORIZE_TIMEOUT_MS,
    );
    cancel = () => {
      clearTimeout(timer);
      reject(new SignInCancelledError());
    };
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const error = url.searchParams.get("error");
      const receivedCode = url.searchParams.get("code");
      if (!error && !receivedCode) {
        res.writeHead(404).end();
        return;
      }
      const finish = (status: number, title: string, detail: string) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(signInPage({ title, detail, ok: status === 200 }));
        clearTimeout(timer);
      };
      if (url.searchParams.get("state") !== state) {
        finish(400, "This sign-in link is stale", "Return to Otter Mail and try again.");
        reject(new Error("Google sign-in returned an unexpected state."));
      } else if (error) {
        finish(400, "Sign-in cancelled", "You can close this tab.");
        reject(new Error(`Google sign-in failed: ${error}`));
      } else {
        finish(200, "Signed in", "You can close this tab and return to Otter Mail.");
        resolve(receivedCode!);
      }
    });

    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: (opts.purpose === "mail" ? SCOPES : IDENTITY_SCOPES).join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...(opts.purpose === "mail"
        ? { access_type: "offline", prompt: "consent" }
        : { prompt: "select_account" }),
      ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
    }).toString();
    requestMain("openExternal", { url: authorizeUrl.toString() }).catch((err: unknown) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  const attempt = { cancel, done: waitForCode.catch(() => {}) };
  pendingSignIn = attempt;

  try {
    const code = await waitForCode;
    return { code, redirectUri, verifier };
  } finally {
    if (pendingSignIn === attempt) pendingSignIn = null;
    server.close();
  }
}

async function addAccount(loginHint?: string): Promise<MailAccount> {
  let tokens: StoredTokens;
  try {
    const { code, redirectUri, verifier } = await authorizeInBrowser({
      purpose: "mail",
      loginHint,
    });
    tokens = toStored(
      (await getCredentials()).clientId,
      await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    );
  } catch (err) {
    if (err instanceof SignInCancelledError) throw err;
    throw new Error(`Google OAuth authorization failed: ${String(err)}`, { cause: err });
  }
  return saveAccount(tokens);
}

async function addDemoAccount(mailbox: DemoGmailMailbox): Promise<MailAccount> {
  const refreshToken = mailbox.refreshTokens.desktop;
  if (!refreshToken) {
    throw new Error(
      `${mailbox.email} has no Mac app sign-in yet: run \`pnpm dev:demo:desktop --login\`.`,
    );
  }
  const response = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return saveAccount(toStored((await getCredentials()).clientId, response, refreshToken));
}

async function saveAccount(tokens: StoredTokens): Promise<MailAccount> {
  // Right after a new grant, Google can answer 500 for a few seconds.
  let userInfoResponse: Response;
  for (let attempt = 1; ; attempt++) {
    userInfoResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (userInfoResponse.status < 500 || attempt === 4) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  if (!userInfoResponse.ok) {
    throw new Error(
      `Failed to fetch Google user info: ${userInfoResponse.status} ${userInfoResponse.statusText}`,
    );
  }
  const userInfo = (await userInfoResponse.json()) as {
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!userInfo.email) {
    throw new Error("Google user info did not return an email address.");
  }

  const email = userInfo.email;
  const store = await loadStore();
  store.set(email, tokens);
  await saveStore();
  tokenCache.delete(email);

  // Signing in again (a new permission, an expired sign-in) keeps what the mailbox already had:
  // its display name, color, signature, addresses. Not another kind of mailbox's at that address.
  const existing = await accountStore.getAccount(email);
  const account: MailAccount = {
    ...(existing && (existing.provider ?? "gmail") === "gmail" ? existing : {}),
    id: email,
    email,
    name: userInfo.name ?? email,
    picture: userInfo.picture,
  };
  await accountStore.addAccount(account);
  return account;
}

async function signInForIdToken(): Promise<string> {
  const { code, redirectUri, verifier } = await authorizeInBrowser({ purpose: "identity" });
  const response = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!response.id_token) throw new Error("Google did not return an ID token.");
  return response.id_token;
}

async function loadSignIns(): Promise<void> {
  await loadStore();
}

function isSignedIn(accountId: string): boolean {
  return storeCache?.has(accountId) ?? true;
}

const REFRESH_AHEAD_MS = 2 * 60_000;

type CachedToken = { accessToken: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();
const tokenLoads = new Map<string, Promise<string>>();

async function refreshTokens(accountId: string): Promise<TokenResponse> {
  const store = await loadStore();
  const stored = store.get(accountId);
  if (!stored) throw new Error(SIGNED_OUT_MESSAGE);
  let response: TokenResponse;
  try {
    response = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    });
  } catch (err) {
    if (err instanceof SignInExpiredError) {
      logger.warn("oauth", "Google revoked this account's sign-in", { accountId });
      store.delete(accountId);
      await saveStore();
      broadcast("gmail:accounts-changed");
    }
    throw err;
  }
  const refreshed = toStored((await getCredentials()).clientId, response, stored.refreshToken);
  // The account may have been removed while the refresh was in flight.
  if (store.has(accountId)) {
    store.set(accountId, refreshed);
    await saveStore();
  }
  tokenCache.set(accountId, { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt });
  return response;
}

async function loadAccessToken(accountId: string, forceRefresh: boolean): Promise<string> {
  const stored = (await loadStore()).get(accountId);
  if (!stored) throw new Error(SIGNED_OUT_MESSAGE);
  if (!forceRefresh && stored.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
    tokenCache.set(accountId, { accessToken: stored.accessToken, expiresAt: stored.expiresAt });
    return stored.accessToken;
  }
  return (await refreshTokens(accountId)).access_token;
}

async function getIdToken(accountId: string): Promise<string> {
  const { id_token } = await refreshTokens(accountId);
  if (!id_token)
    throw new Error("Google did not return an ID token. Sign in to this account again.");
  return id_token;
}

async function getAccessToken(
  accountId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  const cached = tokenCache.get(accountId);
  if (!opts?.forceRefresh && cached && cached.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
    return cached.accessToken;
  }
  const pending = tokenLoads.get(accountId);
  // A 401 on a token that a running load is about to replace: join that load.
  if (pending && !(opts?.forceRefresh && cached)) return pending;
  if (opts?.forceRefresh) tokenCache.delete(accountId);
  const load = loadAccessToken(accountId, opts?.forceRefresh === true).finally(() => {
    if (tokenLoads.get(accountId) === load) tokenLoads.delete(accountId);
  });
  tokenLoads.set(accountId, load);
  return load;
}

async function removeAccountTokens(accountId: string): Promise<void> {
  tokenCache.delete(accountId);
  const store = await loadStore();
  if (store.delete(accountId)) await saveStore();
}

export const googleAuth: GoogleAuth = {
  load: loadSignIns,
  addAccount,
  addDemoAccount,
  cancelSignIn,
  isSignedIn,
  getAccessToken,
  getIdToken,
  removeTokens: removeAccountTokens,
  signInForIdToken,
};
