import { zValidator } from "@hono/zod-validator";
import * as Sentry from "@sentry/cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono, type MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { setSignedCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  type AgentPointer,
  GMAIL_SIGN_IN_CANCELLED,
  isAliasPictures,
  isMailboxPicture,
  type ListAccountsResponse,
  type MeResponse,
  type OutlookWatchResponse,
  type PreferencesResponse,
  type RelayEvent,
  type RelayUser,
  type SignInMethod,
  TUNNEL_CLOSE,
} from "@otter/contracts/relay";
import type { MailProviderKind } from "@otter/contracts/mail";
import { CHAT_LIMITS, type Chat, type ListChatsResponse } from "@otter/contracts/chats";

import { createAuth, googleClientIds, googleKeys, type Auth } from "./auth.ts";
import * as agentChannels from "./agent-channels.ts";
import * as chats from "./chats.ts";
import * as gmail from "./gmail.ts";
import { InvalidTokenError, remoteKeys, verifyGoogleJwt } from "./google-jwt.ts";
import identity from "./identity.ts";
import { MICROSOFT_JWKS_URL, provesMailbox, verifyMicrosoftJwt } from "./microsoft-jwt.ts";
import * as outlook from "./outlook.ts";
import * as preferences from "./preferences.ts";
import * as store from "./store.ts";
import * as push from "./push.ts";
import * as notificationConnections from "./notification-connections.ts";
import { errorReports } from "./error-reports.ts";
import { AgentHub as AgentHubObject } from "./agent-hub.ts";
import { NotificationMailbox as NotificationMailboxObject } from "./notification-mailbox.ts";
import * as apns from "./apns.ts";
import * as tunnel from "./tunnel.ts";
import { forHost } from "./hosts.ts";
import { SESSION_HEADER, UserHub as UserHubObject } from "./user-hub.ts";

export const AgentHub = Sentry.instrumentDurableObjectWithSentry(errorReports, AgentHubObject);
export const UserHub = Sentry.instrumentDurableObjectWithSentry(errorReports, UserHubObject);
export const NotificationMailbox = Sentry.instrumentDurableObjectWithSentry(
  errorReports,
  NotificationMailboxObject,
);

export interface Env {
  NOTIFICATION_MAILBOX: DurableObjectNamespace<NotificationMailboxObject>;
  NOTIFICATION_CREDENTIAL_SECRET?: string;
  NOTIFICATION_GOOGLE_CLIENT_ID?: string;
  NOTIFICATION_GOOGLE_CLIENT_SECRET?: string;
  NOTIFICATION_GOOGLE_PUSH_TOPIC?: string;
  NOTIFICATION_GOOGLE_API_ORIGIN?: string;
  NOTIFICATION_MICROSOFT_CLIENT_ID?: string;
  NOTIFICATION_MICROSOFT_CLIENT_SECRET?: string;
  NOTIFICATION_IMAP_TEST_TARGET?: string;
  DB: D1Database;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /** Private compatibility adapter to the independent Otter Accounts service. */
  ACCOUNTS?: {
    fetch(request: Request): Promise<Response>;
    getSession(headers: Record<string, string>): ReturnType<Auth["api"]["getSession"]>;
  };
  IDENTITY_MODE?: "legacy" | "paused" | "accounts";
  ACCOUNTS_ORIGIN?: string;
  USER_HUB: DurableObjectNamespace<UserHubObject>;
  AGENT_HUB?: DurableObjectNamespace<AgentHubObject>;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_IOS_CLIENT_ID?: string;
  GOOGLE_GMAIL_CLIENT_ID: string;
  GOOGLE_GMAIL_CLIENT_SECRET: string;
  /** Where the web app runs (https://mail.otterware.app): trusted for CORS and redirects. */
  APP_ORIGIN: string;
  /** Other hosts the relay answers on, with their own web app: see hosts.ts. */
  RELAY_HOSTS?: string;
  DRIVE_ORIGIN: string;
  COOKIE_DOMAIN?: string;
  PUSH_TOPIC: string;
  PUSH_AUDIENCE: string;
  PUSH_SERVICE_ACCOUNT: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_SANDBOX_TOPIC?: string;
  APNS_PRODUCTION_TOPIC?: string;
  /** Otter Agents (apps/ios-agents): its devices hear what agents ask and send, never mail. */
  APNS_AGENTS_SANDBOX_TOPIC?: string;
  APNS_AGENTS_PRODUCTION_TOPIC?: string;
  APNS_TEST_ORIGIN?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_JWKS_URL?: string;
  GOOGLE_TOKEN_URL?: string;
  /**
   * The web app's Microsoft OAuth client (an Entra app registration, "Web"
   * platform): its Outlook sign-in. Without it and its secret, the web app
   * has no Outlook.
   */
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_DESKTOP_CLIENT_IDS?: string;
  MICROSOFT_JWKS_URL?: string;
  MICROSOFT_TOKEN_URL?: string;
  MICROSOFT_GRAPH_URL?: string;
  TUNNEL_LIMIT: RateLimit;
  /** Tunnels a minute per user to any other host: adding a mailbox, before it's linked. */
  TUNNEL_UNLINKED_LIMIT: RateLimit;
  TUNNEL_TEST_TARGET?: string;
  /**
   * "true" lets the tunnel reach any host and port, a mail server on this
   * machine included. Only `pnpm dev` sets it; never in wrangler.jsonc.
   */
  TUNNEL_ALLOW_PRIVATE?: string;
  /**
   * "true" opens the demo's routes (`pnpm dev:demo`): an Otter session for any
   * address, without Google, and its saved Gmail sign-in sealed for it. Only
   * the dev runner sets it; never in wrangler.jsonc.
   */
  DEV_DEMO?: string;
}

type Session = { id: string; user: RelayUser; expiresAt: number; createdAt: number };

export type App = { Bindings: Env; Variables: { db: store.Db; auth: Auth; session: Session } };

async function verifyIdToken(env: Env, idToken: string) {
  try {
    return await verifyGoogleJwt(idToken, googleClientIds(env), googleKeys(env));
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new HTTPException(401, { message: `Invalid ID token (${err.message}).` });
    }
    throw err;
  }
}

async function provesOutlook(env: Env, idToken: string, email: string) {
  const audiences = [
    env.MICROSOFT_CLIENT_ID,
    ...(env.MICROSOFT_DESKTOP_CLIENT_IDS ?? "").split(","),
  ].filter((id): id is string => Boolean(id));
  try {
    const keys = remoteKeys(env.MICROSOFT_JWKS_URL || MICROSOFT_JWKS_URL);
    return provesMailbox(await verifyMicrosoftJwt(idToken, audiences, keys), email);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new HTTPException(401, { message: `Invalid ID token (${err.message}).` });
    }
    throw err;
  }
}

const hub = (env: Env, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));

const rejectInvalid = (result: { success: boolean }) => {
  if (!result.success) throw new HTTPException(400, { message: "Invalid request." });
};

const profileField = z.string().max(2048).nullable().optional();
const mailbox = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email());

const app = new Hono<App>();

app.use(async (c, next) => {
  c.env = forHost(c.env, c.req.url);
  await next();
});

app.use("/v1/*", (c, next) =>
  cors({ origin: c.env.APP_ORIGIN, credentials: true, maxAge: 86_400 })(c, next),
);

app.use(async (c, next) => {
  if (c.env.IDENTITY_MODE === "paused" && !c.req.path.startsWith("/push/")) {
    c.header("Retry-After", "60");
    return c.json({ error: "Account maintenance in progress. Please try again shortly." }, 503);
  }
  if (
    c.env.IDENTITY_MODE === "accounts" &&
    (c.req.path.startsWith("/v1/auth/") ||
      c.req.path.startsWith("/.well-known/") ||
      c.req.path.startsWith("/otter/"))
  ) {
    if (!c.env.ACCOUNTS) return c.json({ error: "Accounts is unavailable." }, 503);
    if (c.req.path.startsWith("/otter/"))
      return c.redirect(`${c.env.ACCOUNTS_ORIGIN}${c.req.path}${new URL(c.req.url).search}`, 307);
    return c.env.ACCOUNTS.fetch(c.req.raw);
  }
  const db = store.openDb(c.env.DB);
  c.set("db", db);
  c.set("auth", createAuth(c.env, db));
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error("Unhandled error", err);
  Sentry.captureException(err);
  return c.json({ error: "Something went wrong." }, 500);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.get("/", (c) => c.text("Otter relay\n"));

app.get("/v1/notifications/callback", async (c) => {
  const { state, code, error } = c.req.query();
  if (!state) return c.text("Start notification setup in the app.", 400);
  return notificationConnections.callbackResponse(c.env, state, error ? undefined : code);
});

// Reuse Google's registered redirect. A separate state key/audience distinguishes the limited notification grant.
app.get("/v1/gmail/callback", async (c, next) => {
  const { state, code, error } = c.req.query();
  if (state && (await notificationConnections.isAuthorizationState(c.env, state))) {
    return notificationConnections.callbackResponse(c.env, state, error ? undefined : code);
  }
  await next();
});

app.post("/v1/auth/browser-sign-out/start", async (c) => {
  if (c.req.header("origin") !== c.env.APP_ORIGIN) throw new HTTPException(403);
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("authorization");
  const result = await c.var.auth.handler(
    new Request(new URL("/v1/auth/sign-out", c.req.url), {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  if (!result.ok) throw new HTTPException(502, { message: "Could not sign out. Try again." });
  for (const cookie of result.headers.getSetCookie())
    c.header("Set-Cookie", cookie, { append: true });
  c.header("Cache-Control", "no-store");
  return c.redirect(c.env.APP_ORIGIN, 303);
});
app.on(["GET", "POST"], "/v1/auth/*", (c) => c.var.auth.handler(c.req.raw));

/** Everywhere but the demo's local relay, these routes don't exist. */
const demoOnly: MiddlewareHandler<App> = async (c, next) => {
  if (c.env.DEV_DEMO !== "true") throw new HTTPException(404, { message: "Not found." });
  await next();
};

app.post(
  "/v1/dev/session",
  demoOnly,
  zValidator("json", z.object({ email: mailbox }), rejectInvalid),
  async (c) => {
    const { email } = c.req.valid("json");
    const ctx = await c.var.auth.$context;
    const user =
      (await ctx.internalAdapter.findUserByEmail(email))?.user ??
      (await ctx.internalAdapter.createUser(
        { email, name: email, emailVerified: true },
        { method: "admin" },
      ));
    const session = await ctx.internalAdapter.createSession(user.id, false);
    const cookie = ctx.authCookies.sessionToken;
    await setSignedCookie(c, cookie.name, session.token, ctx.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: cookie.attributes.maxAge,
    });
    return c.json({ email });
  },
);
app.get("/.well-known/*", (c) => c.var.auth.handler(c.req.raw));
app.route("/otter", identity);

const authed = new Hono<App>();

authed.use(async (c, next) => {
  const central = c.env.IDENTITY_MODE === "accounts";
  const found = central
    ? await c.env.ACCOUNTS?.getSession(Object.fromEntries(c.req.raw.headers))
    : await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!found) throw new HTTPException(401, { message: "Not signed in." });
  const { session, user } = found;
  if (central) await store.ensureUser(c.env.DB, user);
  c.set("session", {
    id: session.id,
    expiresAt: session.expiresAt.getTime(),
    createdAt: session.createdAt.getTime(),
    user: {
      id: user.id,
      email: user.email,
      name: user.name || null,
      picture: user.image ?? null,
      ...("signInMethods" in user && Array.isArray(user.signInMethods)
        ? { signInMethods: user.signInMethods as SignInMethod[] }
        : {}),
    },
  });
  await next();
});

authed.route("/", notificationConnections.routes());
authed.route("/", agentChannels.routes());
authed.all("/agent/*", async (c) => {
  if (c.req.header("origin") && c.req.header("origin") !== c.env.APP_ORIGIN)
    throw new HTTPException(403, { message: "Not from the web app." });
  if (!c.env.AGENT_HUB)
    throw new HTTPException(503, { message: "The agent server is not configured." });
  const headers = new Headers(c.req.raw.headers);
  headers.set(SESSION_HEADER, c.var.session.id);
  return c.env.AGENT_HUB.get(c.env.AGENT_HUB.idFromName(c.var.session.user.id)).fetch(
    new Request(c.req.raw, { headers }),
  );
});

authed.get("/gmail/authorize", (c) =>
  gmail
    .authorizeUrl(c.env, c.var.session.user.id, c.req.query("login_hint"))
    .then((url) => c.redirect(url)),
);

authed.get("/gmail/callback", async (c) => {
  const { code, state, error } = c.req.query();
  try {
    if (error === "access_denied")
      return gmail.popupResponse(c.env, { error: GMAIL_SIGN_IN_CANCELLED });
    if (error || !code || !state) throw new Error(error ?? "missing code");
    if ((await gmail.stateUser(c.env, state)) !== c.var.session.user.id) {
      throw new Error("signed in as someone else");
    }
    return gmail.popupResponse(c.env, {
      result: await gmail.completeSignIn(c.env, c.var.session.user.id, code),
    });
  } catch (err) {
    console.warn("Gmail sign-in failed", String(err));
    return gmail.popupResponse(c.env, { error: String(err) });
  }
});

authed.post(
  "/gmail/token",
  zValidator("json", z.object({ sealed: z.string() }), rejectInvalid),
  async (c) => {
    try {
      return c.json(await gmail.refresh(c.env, c.var.session.user.id, c.req.valid("json").sealed));
    } catch (err) {
      if (err instanceof gmail.GoogleTokenError && err.revoked) {
        throw new HTTPException(410, { message: "Google revoked this sign-in." });
      }
      if (err instanceof gmail.GoogleTokenError)
        throw new HTTPException(502, { message: err.message });
      throw new HTTPException(400, { message: "Invalid sealed token." });
    }
  },
);

authed.post(
  "/dev/gmail",
  demoOnly,
  zValidator("json", z.object({ refreshToken: z.string().min(1) }), rejectInvalid),
  async (c) =>
    c.json(await gmail.demoSignIn(c.env, c.var.session.user.id, c.req.valid("json").refreshToken)),
);

authed.post(
  "/dev/outlook",
  demoOnly,
  zValidator("json", z.object({ refreshToken: z.string().min(1) }), rejectInvalid),
  async (c) =>
    c.json(
      await outlook.demoSignIn(c.env, c.var.session.user.id, c.req.valid("json").refreshToken),
    ),
);

authed.get("/outlook/authorize", async (c) => {
  if (!outlook.configured(c.env))
    throw new HTTPException(503, { message: "Outlook sign-in is not configured." });
  return c.redirect(
    await outlook.authorizeUrl(c.env, c.var.session.user.id, c.req.query("login_hint")),
  );
});

authed.get("/outlook/callback", async (c) => {
  const { code, state, error } = c.req.query();
  try {
    if (error === "access_denied")
      return outlook.popupResponse(c.env, { error: GMAIL_SIGN_IN_CANCELLED });
    if (error || !code || !state) throw new Error(error ?? "missing code");
    if ((await outlook.stateUser(c.env, state)) !== c.var.session.user.id) {
      throw new Error("signed in as someone else");
    }
    return outlook.popupResponse(c.env, {
      result: await outlook.completeSignIn(c.env, c.var.session.user.id, code),
    });
  } catch (err) {
    console.warn("Outlook sign-in failed", String(err));
    return outlook.popupResponse(c.env, { error: String(err) });
  }
});

authed.post(
  "/outlook/token",
  zValidator("json", z.object({ sealed: z.string() }), rejectInvalid),
  async (c) => {
    try {
      return c.json(
        await outlook.refresh(c.env, c.var.session.user.id, c.req.valid("json").sealed),
      );
    } catch (err) {
      if (err instanceof outlook.MicrosoftTokenError && err.revoked) {
        throw new HTTPException(410, { message: "Microsoft revoked this sign-in." });
      }
      if (err instanceof outlook.MicrosoftTokenError)
        throw new HTTPException(502, { message: err.message });
      throw new HTTPException(400, { message: "Invalid sealed token." });
    }
  },
);

authed.post(
  "/outlook/watch",
  zValidator("json", z.object({ email: mailbox }), rejectInvalid),
  async (c) => {
    const { email } = c.req.valid("json");
    if ((await store.linkedProvider(c.var.db, c.var.session.user.id, email)) !== "outlook") {
      throw new HTTPException(404, { message: "No such Outlook mailbox." });
    }
    return c.json({
      notificationUrl: outlook.notificationUrl(c.env, email),
      clientState: await outlook.clientState(c.env, email),
    } satisfies OutlookWatchResponse);
  },
);

authed.get("/me", (c) => {
  const env = c.env;
  return c.json({
    user: c.var.session.user,
    pushTopic: env.PUSH_TOPIC,
    outlook: outlook.configured(env),
  } satisfies MeResponse);
});

authed.put(
  "/push/device",
  zValidator(
    "json",
    z
      .object({
        token: z
          .string()
          .regex(/^(?:[a-fA-F0-9]{2}){1,256}$/)
          .transform((value) => value.toLowerCase()),
        topic: z.string().min(1).max(255),
        environment: z.enum(["sandbox", "production"]),
        mode: z.enum(["off", "inbox", "all"]),
        mailboxes: z.array(mailbox).max(32),
      })
      .strict(),
    rejectInvalid,
  ),
  async (c) => {
    if (!apns.configured(c.env))
      throw new HTTPException(503, { message: "iPhone push is not configured." });
    await push.register(c.env, c.var.session, c.req.valid("json"));
    for (const email of c.req.valid("json").mailboxes) {
      if (await notificationConnections.connection(c.env, c.var.session.user.id, email)) {
        await notificationConnections.nudge(c.env, c.var.session.user.id, email);
      }
    }
    return c.body(null, 204);
  },
);

authed.delete("/push/device", async (c) => {
  await push.remove(c.env, c.var.session.user.id, c.var.session.id);
  return c.body(null, 204);
});

/**
 * `?providers=gmail,imap,outlook`: the providers the client knows. Builds
 * from before IMAP don't send it, and would take any mailbox for a Gmail
 * account.
 */
const providersQuery = z.object({
  providers: z
    .string()
    .optional()
    .transform((list) =>
      (list ?? "gmail")
        .split(",")
        .filter((p): p is MailProviderKind => p === "gmail" || p === "imap" || p === "outlook"),
    ),
});

authed.get("/accounts", zValidator("query", providersQuery, rejectInvalid), async (c) => {
  const { providers } = c.req.valid("query");
  const accounts = await store.listAccounts(c.var.db, c.var.session.user.id, providers);
  return c.json({ accounts } satisfies ListAccountsResponse);
});

const mailServer = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls"]),
});

/**
 * Link a mailbox, or update its profile. Linking a Gmail or Outlook account
 * needs an ID token (Google's, Microsoft's) for that address: the caller
 * signed in to it. Linking an IMAP one needs its settings. Later edits need
 * neither, and can't change the provider.
 */
authed.put(
  "/accounts/:email",
  zValidator("param", z.object({ email: mailbox }), rejectInvalid),
  zValidator(
    "json",
    z.object({
      idToken: z.string().optional(),
      provider: z.enum(["gmail", "imap", "outlook"]).optional(),
      imap: z
        .object({ username: z.string().min(1).max(320), imap: mailServer, smtp: mailServer })
        .optional(),
      name: profileField,
      picture: profileField,
      displayName: profileField,
      color: profileField,
      customPicture: z.string().refine(isMailboxPicture).nullable().optional(),
      aliasPictures: z.record(z.string(), z.string()).refine(isAliasPictures).nullable().optional(),
    }),
    rejectInvalid,
  ),
  async (c) => {
    const { email } = c.req.valid("param");
    const { idToken, ...patch } = c.req.valid("json");
    const { db, session } = c.var;
    const linked = await store.linkedProvider(db, session.user.id, email);
    const provider = patch.provider ?? linked ?? "gmail";
    if (linked && linked !== provider) {
      throw new HTTPException(409, { message: `Linked as ${linked}: unlink it first.` });
    }
    if (provider !== "imap" && patch.imap) {
      throw new HTTPException(400, { message: "IMAP settings are for IMAP mailboxes." });
    }
    if (!linked && provider === "imap" && !patch.imap) {
      throw new HTTPException(400, { message: "Linking an IMAP mailbox needs its settings." });
    }
    if (!linked && provider === "gmail") {
      if (!idToken) throw new HTTPException(403, { message: "Linking needs an ID token." });
      if ((await verifyIdToken(c.env, idToken)).email !== email) {
        throw new HTTPException(403, { message: "The ID token is for another address." });
      }
    }
    if (!linked && provider === "outlook") {
      if (!idToken) throw new HTTPException(403, { message: "Linking needs an ID token." });
      if (!(await provesOutlook(c.env, idToken, email))) {
        throw new HTTPException(403, { message: "The ID token doesn't prove this address." });
      }
    }
    await store.putAccount(db, session.user.id, email, patch);
    await hub(c.env, session.user.id).publish({ type: "accounts" });
    return c.body(null, 204);
  },
);

authed.delete(
  "/accounts/:email",
  zValidator("param", z.object({ email: mailbox }), rejectInvalid),
  zValidator("query", providersQuery, rejectInvalid),
  async (c) => {
    const userId = c.var.session.user.id;
    const { email } = c.req.valid("param");
    if (await store.deleteAccount(c.var.db, userId, email, c.req.valid("query").providers)) {
      await notificationConnections.remove(c.env, userId, email);
      await hub(c.env, userId).forgetPush(email);
      await hub(c.env, userId).publish({ type: "accounts" });
    }
    return c.body(null, 204);
  },
);

authed.get("/preferences", async (c) =>
  c.json(
    (await preferences.read(
      c.var.db,
      c.env.BETTER_AUTH_SECRET,
      c.var.session.user.id,
    )) satisfies PreferencesResponse,
  ),
);

authed.put(
  "/preferences",
  zValidator(
    "json",
    z.object({
      preferences: z
        .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/), z.unknown())
        .optional(),
      hermesKey: z.string().max(4096).nullable().optional(),
    }),
    rejectInvalid,
  ),
  async (c) => {
    const userId = c.var.session.user.id;
    if (
      !(await preferences.write(c.var.db, c.env.BETTER_AUTH_SECRET, userId, c.req.valid("json")))
    ) {
      throw new HTTPException(413, { message: "Preferences too large." });
    }
    await hub(c.env, userId).publish({ type: "preferences" });
    return c.body(null, 204);
  },
);

async function chatsChanged(env: Env, userId: string): Promise<void> {
  await hub(env, userId).publish({ type: "chats", email: "" });
}

const chatId = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) });
const timestamp = z.number().int().nonnegative();
const tabRef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["thread", "draft"]),
    accountId: z.string().max(320),
    id: z.string().max(512),
  }),
  z.object({ kind: z.literal("page"), url: z.string().max(2048) }),
  z.object({ kind: z.literal("file"), href: z.string().max(2048) }),
]);
const chatBody = z.object({
  id: z.string(),
  title: z.string().max(CHAT_LIMITS.title + 1),
  provider: z.string().regex(/^[a-z0-9-]{1,40}$/),
  sessionId: z.string().max(256).nullable(),
  sessionOwned: z.boolean(),
  lastResponseId: z.string().max(256).nullable(),
  device: z.object({ id: z.string().max(64), name: z.string().max(200) }).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  snoozedUntil: timestamp.nullish(),
  settledAt: timestamp.nullish(),
  pinnedAt: timestamp.nullish(),
  returnedAt: timestamp.nullish(),
  tabs: z
    .array(
      z.object({
        id: z.string().max(2600),
        title: z.string().max(CHAT_LIMITS.title + 1),
        ref: tabRef,
        addedAt: timestamp,
        made: z.boolean().optional(),
        closedAt: timestamp.nullish(),
      }),
    )
    .max(CHAT_LIMITS.tabs),
  turns: z
    .array(
      z.looseObject({
        id: z.string().max(200),
        role: z.enum(["user", "assistant"]),
        text: z.string(),
      }),
    )
    .max(CHAT_LIMITS.turns),
});

authed.get("/chats", async (c) =>
  c.json({
    chats: await chats.list(c.var.db, c.var.session.user.id),
  } satisfies ListChatsResponse),
);

authed.get("/chats/:id", zValidator("param", chatId, rejectInvalid), async (c) => {
  const chat = await chats.get(c.var.db, c.var.session.user.id, c.req.valid("param").id);
  if (!chat) throw new HTTPException(404, { message: "No such chat." });
  return c.json({ chat });
});

authed.put(
  "/chats/:id",
  bodyLimit({
    maxSize: CHAT_LIMITS.bytes + 64 * 1024,
    onError: () => {
      throw new HTTPException(413, { message: "This chat is too long to keep." });
    },
  }),
  zValidator("param", chatId, rejectInvalid),
  zValidator("json", chatBody, rejectInvalid),
  async (c) => {
    const userId = c.var.session.user.id;
    const chat = c.req.valid("json") as Chat;
    if (chat.id !== c.req.valid("param").id)
      throw new HTTPException(400, { message: "Invalid request." });
    const refusal = await chats.put(c.var.db, userId, chat);
    if (refusal === "stale") throw new HTTPException(409, { message: "This chat changed since." });
    if (refusal === "full") throw new HTTPException(413, { message: "Too many chats." });
    await chatsChanged(c.env, userId);
    return c.body(null, 204);
  },
);

authed.delete("/chats/:id", zValidator("param", chatId, rejectInvalid), async (c) => {
  const userId = c.var.session.user.id;
  if (await chats.remove(c.var.db, userId, c.req.valid("param").id)) {
    await chatsChanged(c.env, userId);
  }
  return c.body(null, 204);
});

authed.get("/events", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    throw new HTTPException(426, { message: "Expected a WebSocket upgrade." });
  }
  const { id, user } = c.var.session;
  const headers = new Headers(c.req.raw.headers);
  headers.set(SESSION_HEADER, id);
  return hub(c.env, user.id).fetch(new Request(c.req.raw, { headers }));
});

/**
 * What a tunnel may carry each way (tunnel.ts). The servers of the user's
 * IMAP mailboxes get enough for mail; any other host, only enough to check a
 * password before the mailbox is linked.
 */
const TUNNEL_BYTES = { linked: 200 * 2 ** 20, unlinked: 2 ** 20 };

/**
 * A TCP connection to a mail server, for the web app (tunnel.ts). Rate
 * limited per user with Workers' rate limiting bindings (wrangler.jsonc),
 * counted in memory at each Cloudflare location: no Durable Object or KV per
 * tunnel.
 */
authed.get(
  "/tunnel",
  zValidator("query", z.object({ host: z.string(), port: z.coerce.number().int() }), rejectInvalid),
  async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      throw new HTTPException(426, { message: "Expected a WebSocket upgrade." });
    }
    const origin = c.req.header("origin");
    if (origin && origin !== c.env.APP_ORIGIN) {
      throw new HTTPException(403, { message: "Not from the web app." });
    }
    const { host, port } = c.req.valid("query");
    const anywhere = c.env.TUNNEL_ALLOW_PRIVATE === "true";
    if (!anywhere && !tunnel.allowed(host, port, c.env.TUNNEL_TEST_TARGET)) {
      throw new HTTPException(400, { message: "Only mail ports on public hosts." });
    }
    const userId = c.var.session.user.id;
    const servers = await store.imapServers(c.var.db, userId);
    const linked = servers.has(`${host.toLowerCase()}:${port}`);
    const limiter = linked ? c.env.TUNNEL_LIMIT : c.env.TUNNEL_UNLINKED_LIMIT;
    if (!(await limiter.limit({ key: userId })).success) {
      return tunnel.refuse(TUNNEL_CLOSE.rateLimited, "Too many connections: try again in a minute");
    }
    return tunnel.open(host, port, linked ? TUNNEL_BYTES.linked : TUNNEL_BYTES.unlinked);
  },
);

app.route("/v1", authed);
app.route(
  "/",
  agentChannels.gatewayRoutes(
    (env, userId, pointer) => hub(env, userId).publish({ type: "agent", email: "", pointer }),
    notifyAgentDevices,
  ),
);

/** Tells the account's Otter Agents iPhones too, for when the app isn't open to hear the event. */
async function notifyAgentDevices(env: Env, userId: string, pointer: AgentPointer): Promise<void> {
  // An approval answered elsewhere is nothing to come back for.
  if (pointer.resolved || !apns.configured(env)) return;
  // Someone is looking at this chat on one of the account's devices: it tells them itself.
  if (pointer.sessionKey && (await hub(env, userId).watching(pointer.sessionKey))) return;
  const devices = await push.agentDevices(env, userId);
  await Promise.all(
    devices.map(async (device) => {
      const result = await apns.sendAgent(env, device, userId, pointer);
      if (result === "invalid") await push.invalidate(env, device);
    }),
  );
}

const gmailNotification = z.object({
  emailAddress: mailbox,
  historyId: z
    .union([z.string(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .transform(String)
    .pipe(z.string().regex(/^\d{1,20}$/)),
});

/**
 * Pub/Sub push of a Gmail notification (`{ emailAddress, historyId }`), sent
 * on to every device of everyone who linked that address. Anything else is
 * acknowledged and dropped: Pub/Sub would only redeliver it.
 */
app.post(
  "/push/gmail",
  bearerAuth({
    verifyToken: async (token, c) => {
      const env = c.env as Env;
      try {
        const claims = await verifyGoogleJwt(token, env.PUSH_AUDIENCE, googleKeys(env));
        return claims.email === env.PUSH_SERVICE_ACCOUNT;
      } catch (err) {
        if (err instanceof InvalidTokenError) return false;
        throw err;
      }
    },
  }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as { message?: { data?: string } } | null;
    let data: unknown = null;
    try {
      data = JSON.parse(
        atob((body?.message?.data ?? "").replaceAll("-", "+").replaceAll("_", "/")),
      );
    } catch {
      // not a Gmail notification
    }
    const parsed = gmailNotification.safeParse(data);
    if (!parsed.success) return c.body(null, 204);

    const email = parsed.data.emailAddress.toLowerCase();
    const event: RelayEvent = { type: "mail", email, historyId: parsed.data.historyId };
    const users = await store.usersWithMailbox(c.var.db, email, "gmail");
    await Promise.all(
      users.map(async (userId) => {
        const target = hub(c.env, userId);
        await target.publish(event);
        await target.queuePush(userId, email, parsed.data.historyId);
      }),
    );
    return c.body(null, 204);
  },
);

/**
 * Microsoft Graph's change notifications for an Outlook mailbox (a
 * subscription a device made with `/v1/outlook/watch`'s answer), sent on as
 * a `mail` event to every device of everyone who linked it as Outlook. Only
 * notifications carrying the mailbox's clientState count; everything is
 * acknowledged (202), or Graph would retry it for hours.
 */
app.post(
  "/push/outlook/:email",
  zValidator("param", z.object({ email: mailbox }), (result, c) => {
    if (!result.success) return c.body(null, 202);
  }),
  async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken !== undefined) {
      c.header("X-Content-Type-Options", "nosniff");
      return c.text(validationToken);
    }
    const { email } = c.req.valid("param");
    const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
    const notifications = Array.isArray(body?.value) ? (body.value as unknown[]) : [];
    let genuine = false;
    for (const note of notifications.slice(0, 100)) {
      const state = (note as { clientState?: unknown } | null)?.clientState;
      if (typeof state === "string" && (await outlook.checkClientState(c.env, email, state))) {
        genuine = true;
        break;
      }
    }
    if (!genuine) return c.body(null, 202);

    const event: RelayEvent = { type: "mail", email, historyId: "" };
    const users = await store.usersWithMailbox(c.var.db, email, "outlook");
    await Promise.all(
      users.map(async (userId) => {
        await hub(c.env, userId).publish(event);
        await notificationConnections.watcher(c.env, userId, email).changed();
      }),
    );
    return c.body(null, 202);
  },
);

/** Account lifecycle calls are private Worker RPC, never public HTTP routes. */
export class IdentityLifecycle extends WorkerEntrypoint<Env> {
  async disconnect(userId: string, sessionId?: string): Promise<void> {
    await push.remove(this.env, userId, sessionId, true);
    await hub(this.env, userId).disconnect(sessionId);
    await this.env.AGENT_HUB?.get(this.env.AGENT_HUB.idFromName(userId)).disconnect(sessionId);
  }
  async deleteUser(userId: string): Promise<void> {
    await this.env.DB.batch([
      this.env.DB.prepare("INSERT OR IGNORE INTO deleted_identity (user_id) VALUES (?)").bind(
        userId,
      ),
      this.env.DB.prepare("DELETE FROM user WHERE id = ?").bind(userId),
    ]);
    await this.disconnect(userId);
    await this.env.AGENT_HUB?.get(this.env.AGENT_HUB.idFromName(userId)).deleteUser();
  }
}

export default Sentry.withSentry(errorReports, app);
