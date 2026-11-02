import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import { HTTPException } from "hono/http-exception";

import { identityApps } from "./schema.ts";
import type { App } from "./worker.ts";

const routes = new Hono<App>();

const script = `
const message = document.querySelector('#message');
async function request(path, body) {
  message.textContent = '';
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Please try again.');
  return data;
}
document.querySelector('#sign-in')?.addEventListener('click', async () => {
  try {
    const data = await request('/v1/auth/sign-in/social', {
      provider: 'google', callbackURL: location.origin + '/otter/account', disableRedirect: true,
      ...(document.body.dataset.query ? { oauth_query: document.body.dataset.query } : {}),
    });
    if (!data.url) throw new Error('Could not start sign-in.');
    location.assign(data.url);
  } catch (error) { message.textContent = error.message; }
});
document.querySelector('#consent')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await request('/v1/auth/oauth2/consent', { accept: event.submitter.value === 'accept', oauth_query: document.body.dataset.query });
    if (data.url) location.assign(data.url);
    else if (data.redirect_uri) location.assign(data.redirect_uri);
  } catch (error) { message.textContent = error.message; }
});
document.querySelector('#delete')?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await request('/otter/delete-account', { confirmation: document.querySelector('#confirmation').value });
    location.assign('/otter/sign-in?deleted=1');
  } catch (error) { message.textContent = error.message; button.disabled = false; }
});
`;

routes.get("/sign-in", (c) => {
  const query = new URL(c.req.url).searchParams;
  return page(
    c,
    "Your Otter account",
    html`
      <p>One account for Otter Mail and Otter Drive. Sign in with Google to continue.</p>
      ${query.has("deleted") ? html`<p>Your Otter account has been deleted.</p>` : ""}
      <button id="sign-in">Continue with Google</button>
    `,
    query.has("client_id") ? query.toString() : "",
  );
});

routes.get("/consent", (c) => {
  const query = new URL(c.req.url).searchParams;
  if (query.get("client_id") !== "otter-drive")
    throw new HTTPException(400, { message: "Unknown app." });
  return page(
    c,
    "Continue to Otter Drive",
    html`
      <p>
        Otter Drive will receive your account ID, name, email address, and profile picture. Your
        mail stays in Otter Mail.
      </p>
      <form id="consent">
        <button value="accept">Continue</button
        ><button class="secondary" value="deny">Cancel</button>
      </form>
    `,
    query.toString(),
  );
});

routes.get("/account", async (c) => {
  const found = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!found) return c.redirect("/otter/sign-in");
  const linked = await c.var.db.query.identityApps.findFirst({
    where: eq(identityApps.userId, found.user.id),
  });
  return page(
    c,
    "Your Otter account",
    html`
      <p>Signed in as <strong>${found.user.email}</strong>.</p>
      <nav>
        <a href=${c.env.APP_ORIGIN}>Open Mail</a><a href=${c.env.DRIVE_ORIGIN}>Open Drive</a>
      </nav>
      <h2>Delete account</h2>
      <p>
        This removes your Otter identity, synced Mail settings and mailbox list, and signs out your
        devices. Your mail stays with your mail provider.
      </p>
      ${linked ? html`<p>This also signs you out of Drive and removes your API keys. First delete your personal Drive documents and transfer or delete any shared drives you own. Documents in shared drives owned by other people stay with them.</p>` : ""}
      <p>Sign in within the last ten minutes before deleting your account.</p>
      <button id="sign-in" class="secondary">Sign in again</button>
      <form id="delete">
        <label for="confirmation">Type DELETE to confirm</label
        ><input id="confirmation" autocomplete="off" required pattern="DELETE" /><button
          class="danger"
        >
          Delete Otter account
        </button>
      </form>
    `,
  );
});

routes.post("/delete-account", async (c) => {
  if (c.req.header("origin") !== new URL(c.env.BETTER_AUTH_URL).origin) {
    throw new HTTPException(403, {
      message: "Open your Otter account page to delete your account.",
    });
  }
  const found = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!found) throw new HTTPException(401, { message: "Sign in first." });
  if (Date.now() - found.session.createdAt.getTime() > 10 * 60_000) {
    throw new HTTPException(403, { message: "Sign in again before deleting your account." });
  }
  const body = await c.req.json<{ confirmation?: string }>();
  if (body.confirmation !== "DELETE")
    throw new HTTPException(400, { message: "Type DELETE to confirm." });
  const linked = await c.var.db.query.identityApps.findFirst({
    where: eq(identityApps.userId, found.user.id),
  });
  if (linked) {
    const now = Math.floor(Date.now() / 1000);
    const { token } = await c.var.auth.api.signJWT({
      body: {
        payload: {
          sub: found.user.id,
          aud: "otter-drive",
          iat: now,
          exp: now + 60,
          jti: crypto.randomUUID(),
          event: "otter.account.delete",
        },
      },
    });
    // Fail closed: don't delete the identity until Drive has released it.
    const response = await fetch(`${c.env.DRIVE_ORIGIN}/api/identity/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new HTTPException(409, {
        message: "Drive is unavailable. Your account has not been deleted; please try again.",
      });
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new HTTPException(409, {
        message: data.message ?? "Drive couldn't release this account. Please try again.",
      });
    }
    await c.var.db.delete(identityApps).where(eq(identityApps.userId, found.user.id));
  }
  return c.var.auth.api.deleteUser({ headers: c.req.raw.headers, body: {}, asResponse: true });
});

function page(c: Context<App>, title: string, content: ReturnType<typeof html>, query = "") {
  const nonce = crypto.randomUUID();
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${title} · Otter</title>
        <style nonce=${nonce}>
          :root {
            color-scheme: light dark;
            font-family: system-ui, sans-serif;
            background: light-dark(#f8f8f7, #171717);
            color: light-dark(#242424, #eee);
          }
          body {
            margin: 0;
            display: grid;
            min-height: 100vh;
            place-items: center;
          }
          main {
            max-width: 420px;
            padding: 40px;
          }
          h1 {
            font-size: 26px;
            letter-spacing: -0.6px;
          }
          h2 {
            margin-top: 36px;
            font-size: 18px;
          }
          p {
            line-height: 1.6;
            color: light-dark(#666, #aaa);
          }
          button,
          input {
            font: inherit;
            box-sizing: border-box;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid light-dark(#ddd, #444);
            width: 100%;
            margin-top: 12px;
          }
          button {
            cursor: pointer;
            background: light-dark(#252525, #eee);
            color: light-dark(white, #181818);
            font-weight: 600;
          }
          button:disabled {
            opacity: 0.5;
          }
          .secondary {
            background: transparent;
            color: inherit;
          }
          .danger {
            background: #a32c2c;
            color: white;
          }
          label {
            display: block;
            margin-top: 24px;
            font-size: 14px;
          }
          nav {
            display: flex;
            gap: 24px;
          }
          a {
            color: inherit;
          }
          #message {
            color: light-dark(#a32c2c, #ff9999);
          }
          small {
            letter-spacing: 2px;
            font-weight: 600;
          }
        </style>
      </head>
      <body data-query=${query}>
        <main>
          <small>OTTER</small>
          <h1>${title}</h1>
          ${content}
          <p id="message" role="alert"></p>
        </main>
        <script nonce=${nonce}>
          ${raw(script)};
        </script>
      </body>
    </html>`);
}

export default routes;
