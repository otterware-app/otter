import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";

import { MICROSOFT_AUTHORITY, OUTLOOK_SCOPES } from "@otter-mail/contracts";
import type { DemoOutlookMailbox } from "@otter-mail/contracts/demo";
import {
  broadcast,
  GRAPH_ME_URL,
  logger,
  OUTLOOK_SIGNED_OUT_MESSAGE,
  SignInCancelledError,
  signInFromMe,
  type MicrosoftAuth,
  type MicrosoftSignIn,
} from "@otter-mail/core";

import { signInPage } from "@otter-mail/shared/sign-in-page";

import { appInfo } from "../backend-protocol.js";
import { requestMain } from "../main-link.js";

declare const __MICROSOFT_CLIENT_ID__: string;

const AUTHORIZE_URL = `${MICROSOFT_AUTHORITY}/authorize`;
const TOKEN_URL = `${MICROSOFT_AUTHORITY}/token`;
const AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

function clientId(): string {
  return process.env.OTTER_MAIL_MICROSOFT_CLIENT_ID?.trim() || __MICROSOFT_CLIENT_ID__;
}

function requireClientId(): string {
  const id = clientId();
  if (!id) {
    throw new Error(
      "This build has no Microsoft OAuth client. Set OTTER_MAIL_MICROSOFT_CLIENT_ID (see .env.example).",
    );
  }
  return id;
}

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type TokenFile = { version: 1; accounts: Record<string, string> };

let storeCache: Map<string, StoredTokens> | null = null;
let storeLoad: Promise<Map<string, StoredTokens>> | null = null;
let storeWrite: Promise<void> = Promise.resolve();

function tokenFilePath(): string {
  return path.join(appInfo().stateDir, "microsoft-tokens.json");
}

function loadStore(): Promise<Map<string, StoredTokens>> {
  return (storeLoad ??= readStore().then((store) => (storeCache = store)));
}

async function readStore(): Promise<Map<string, StoredTokens>> {
  const store = new Map<string, StoredTokens>();
  try {
    const file = JSON.parse(await fs.readFile(tokenFilePath(), "utf-8")) as TokenFile;
    for (const [accountId, sealed] of Object.entries(file.accounts ?? {})) {
      try {
        store.set(accountId, JSON.parse(await requestMain("unseal", { sealed })) as StoredTokens);
      } catch (err) {
        logger.warn("oauth", "Couldn't load stored Microsoft sign-in", {
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

class SignInExpiredError extends Error {}

type TokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireClientId(),
      scope: OUTLOOK_SCOPES.join(" "),
      ...params,
    }),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    const detail = json.error_description || json.error || `HTTP ${response.status}`;
    if (json.error === "invalid_grant" || json.error === "interaction_required") {
      throw new SignInExpiredError(detail);
    }
    throw new Error(`Microsoft token request failed: ${detail}`);
  }
  return json;
}

function toStored(response: TokenResponse, previousRefreshToken?: string): StoredTokens {
  const refreshToken = response.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Microsoft did not return a refresh token. Sign in to this mailbox again.");
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
  };
}

let pendingSignIn: { cancel: () => void; done: Promise<unknown> } | null = null;

function cancelSignIn(): void {
  pendingSignIn?.cancel();
}

async function authorizeInBrowser(loginHint?: string): Promise<{
  code: string;
  redirectUri: string;
  verifier: string;
}> {
  if (pendingSignIn) {
    pendingSignIn.cancel();
    await pendingSignIn.done;
  }
  const id = requireClientId();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) resolve(address.port);
      else reject(new Error("Couldn't listen for the Microsoft sign-in."));
    });
  });
  // Microsoft only matches http://localhost (any port) for desktop clients, not 127.0.0.1.
  const redirectUri = `http://localhost:${port}`;

  let cancel = () => {};
  const waitForCode = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Microsoft sign-in timed out. Try adding the mailbox again.")),
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
        reject(new Error("Microsoft sign-in returned an unexpected state."));
      } else if (error) {
        finish(400, "Sign-in cancelled", "You can close this tab.");
        if (error === "access_denied") reject(new SignInCancelledError());
        else {
          const detail = url.searchParams.get("error_description") || error;
          reject(new Error(`Microsoft sign-in failed: ${detail}`));
        }
      } else {
        finish(200, "Signed in", "You can close this tab and return to Otter Mail.");
        resolve(receivedCode!);
      }
    });

    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: OUTLOOK_SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      ...(loginHint ? { login_hint: loginHint } : {}),
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

async function addAccount(loginHint?: string): Promise<MicrosoftSignIn> {
  let tokens: StoredTokens;
  try {
    const { code, redirectUri, verifier } = await authorizeInBrowser(loginHint);
    tokens = toStored(
      await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    );
  } catch (err) {
    if (err instanceof SignInCancelledError) throw err;
    throw new Error(`Microsoft sign-in failed: ${String(err)}`, { cause: err });
  }
  return keepSignIn(tokens);
}

async function addDemoAccount(mailbox: DemoOutlookMailbox): Promise<MicrosoftSignIn> {
  const refreshToken = mailbox.refreshTokens.desktop;
  if (!refreshToken) {
    throw new Error(
      `${mailbox.email} has no Mac app sign-in yet: run \`pnpm dev:demo:desktop --login\`.`,
    );
  }
  return keepSignIn(
    toStored(await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken })),
  );
}

async function keepSignIn(tokens: StoredTokens): Promise<MicrosoftSignIn> {
  const response = await fetch(GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Couldn't ask Microsoft who signed in (${response.status}).`);
  }
  const signIn = signInFromMe((await response.json()) as Parameters<typeof signInFromMe>[0]);

  const store = await loadStore();
  store.set(signIn.email, tokens);
  await saveStore();
  tokenCache.delete(signIn.email);
  return signIn;
}

const REFRESH_AHEAD_MS = 2 * 60_000;

type CachedToken = { accessToken: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();
const tokenLoads = new Map<string, Promise<string>>();
const refreshes = new Map<string, Promise<TokenResponse>>();

function refreshTokens(accountId: string): Promise<TokenResponse> {
  let pending = refreshes.get(accountId);
  if (pending) return pending;
  pending = (async () => {
    const store = await loadStore();
    const stored = store.get(accountId);
    if (!stored) throw new Error(OUTLOOK_SIGNED_OUT_MESSAGE);
    let response: TokenResponse;
    try {
      response = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
      });
    } catch (err) {
      if (!(err instanceof SignInExpiredError)) throw err;
      logger.warn("oauth", "Microsoft revoked this mailbox's sign-in", {
        accountId,
        error: err.message,
      });
      store.delete(accountId);
      tokenCache.delete(accountId);
      await saveStore();
      broadcast("gmail:accounts-changed");
      throw new Error(OUTLOOK_SIGNED_OUT_MESSAGE, { cause: err });
    }
    const refreshed = toStored(response, stored.refreshToken);
    // The mailbox may have been removed while the refresh was in flight.
    if (store.has(accountId)) {
      store.set(accountId, refreshed);
      await saveStore();
    }
    tokenCache.set(accountId, {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return response;
  })().finally(() => refreshes.delete(accountId));
  refreshes.set(accountId, pending);
  return pending;
}

async function loadAccessToken(accountId: string, forceRefresh: boolean): Promise<string> {
  const stored = (await loadStore()).get(accountId);
  if (!stored) throw new Error(OUTLOOK_SIGNED_OUT_MESSAGE);
  if (!forceRefresh && stored.expiresAt - REFRESH_AHEAD_MS > Date.now()) {
    tokenCache.set(accountId, { accessToken: stored.accessToken, expiresAt: stored.expiresAt });
    return stored.accessToken;
  }
  return (await refreshTokens(accountId)).access_token;
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
  if (pending && !(opts?.forceRefresh && cached)) return pending;
  if (opts?.forceRefresh) tokenCache.delete(accountId);
  const load = loadAccessToken(accountId, opts?.forceRefresh === true).finally(() => {
    if (tokenLoads.get(accountId) === load) tokenLoads.delete(accountId);
  });
  tokenLoads.set(accountId, load);
  return load;
}

async function getIdToken(accountId: string): Promise<string> {
  const { id_token } = await refreshTokens(accountId);
  if (!id_token) {
    throw new Error("Microsoft did not return an ID token. Sign in to this mailbox again.");
  }
  return id_token;
}

export const microsoftAuth: MicrosoftAuth = {
  available: async () => clientId() !== "",
  async load() {
    await loadStore();
  },
  addAccount,
  addDemoAccount,
  cancelSignIn,
  isSignedIn: (accountId) => storeCache?.has(accountId) ?? true,
  getAccessToken,
  getIdToken,
  async removeTokens(accountId) {
    tokenCache.delete(accountId);
    const store = await loadStore();
    if (store.delete(accountId)) await saveStore();
  },
};
