# Development

## Prerequisites

- An Apple Silicon Mac with macOS 26 or newer (the translator uses Apple's Translation framework),
  or Linux (Debian 12+, Ubuntu 22.04+) for everything but the translator and the iPhone app.
- Node 24 (`engines` in `package.json`) and pnpm 11 via `corepack enable`.
- Full Xcode 26 or newer, selected with `sudo xcode-select -s /Applications/Xcode.app`, to build
  `native/translator`. Without it the app still runs; translation just fails.

## Commands

| Command                                 | What it does                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm install`                          | Installs dependencies and the git pre-commit hook (formats staged files).                |
| `pnpm dev[:fake\|:demo]`                | The web app and a local relay (see [What a dev run opens on](#what-a-dev-run-opens-on)). |
| `pnpm dev:desktop[:fake\|:demo\|:real]` | Vite dev server + main-process watcher + Electron, restarting on main changes.           |
| `pnpm imap-server [down]`               | A local IMAP server with a seeded mailbox (see [IMAP locally](#imap-locally)).           |
| `pnpm agents-server [down]`             | Local OpenClaw and Hermes gateways (see [Agent gateways](#agent-gateways)).              |
| `pnpm dev:ios`                          | Builds the iPhone app and runs it in the simulator (see `apps/ios/README.md`).           |
| `pnpm ios:resources`                    | Re-exports the demo mailbox and licenses the iPhone apps bundle.                         |
| `pnpm start`                            | Runs the built app unpackaged (`pnpm build` first).                                      |
| `pnpm build`                            | Builds `apps/web/dist` and `apps/desktop/dist-electron`.                                 |
| `pnpm build:translator`                 | Builds the Swift translator helper.                                                      |
| `pnpm typecheck`                        | TypeScript across the workspace.                                                         |
| `pnpm lint` / `pnpm fmt`                | Oxlint and Oxfmt through Vite+.                                                          |
| `pnpm dist:desktop:dmg`                 | Unsigned DMG + ZIP for this Mac's architecture in `release/`.                            |
| `pnpm dist:desktop:deb`                 | The Linux .deb (x64) in `release/`; on Linux.                                            |

The dev commands pick ports from the worktree path, so several checkouts can run at once. Set
`OTTER_PORT_OFFSET` to choose one yourself. `t3.json` sets up new T3 Code worktrees (install,
then symlinks to the main checkout's `.env.local` and `infra/relay/.dev.vars`) and offers the dev
commands, all but `:real`, as scripts. These files are shared, so editing them in a worktree changes the main
checkout's copy too.

## What a dev run opens on

Each dev command is an app and what it opens on: `pnpm dev` for the web app, `pnpm dev:desktop`
for the desktop app, and a suffix for the data.

| Data     | Web             | Desktop                 | What it is                                                                                                                                      |
| -------- | --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty    | `pnpm dev`      | `pnpm dev:desktop`      | A new sandbox with nothing in it. Add what you need.                                                                                            |
| Made-up  | `pnpm dev:fake` | `pnpm dev:desktop:fake` | Made-up mailboxes from pretend services: no accounts, no network ([Made-up mailbox](#made-up-mailbox)). Build and test here.                    |
| Demo     | `pnpm dev:demo` | `pnpm dev:desktop:demo` | The real demo accounts made for development, signed in ([Demo mailboxes](#demo-mailboxes)). For checks against real Google, Microsoft and IMAP. |
| Your own | —               | `pnpm dev:desktop:real` | A copy of your installed app, signed in to your mail ([Your own data](#your-own-data)). Only when you mean to.                                  |

The kinds are defined once, in `packages/contracts/src/dev-data.ts`. `scripts/dev-runner.ts` runs
the processes, `scripts/dev-data.ts` gets each kind ready, and `scripts/installed-app.ts` copies
the installed app for `:real`. The desktop app keeps each kind in a home of its own
([Data homes](#data-homes)), so they never mix; `--reset` starts one over.

## Linux

What differs between macOS and Linux lives in `apps/desktop/src/os` (`HostOS`); a new
OS-specific behavior goes there, with a method on the interface both implement, rather than a
`process.platform` check elsewhere. `pnpm dev:desktop` and `pnpm start` run on Linux as on a
Mac. Without a keyring the desktop knows (GNOME Keyring, KWallet), secrets are sealed with an
app key: run under GNOME or KDE, or set `XDG_CURRENT_DESKTOP=GNOME` with gnome-keyring running,
to exercise the keyring.

## Data homes

Like T3 Code, data lives under a home, `~/.otter` (or `OTTER_HOME`), with one state
directory per kind of run, so development never shares a database with the installed app:

| Run                                                    | State directory                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Installed app                                          | `~/.otter/userdata`                                                                     |
| `pnpm dev:desktop` / `pnpm start` in the main checkout | `~/.otter/dev`                                                                          |
| `pnpm dev:desktop` / `pnpm start` in a linked worktree | `<worktree>/.otter/userdata` (gitignored)                                               |
| `pnpm dev:desktop:<kind>` (fake, demo, real)           | `<worktree>/.otter/<kind>/userdata`, or `~/.otter/<kind>/userdata` in the main checkout |
| `pnpm dev:desktop[:<kind>] --home <dir>`               | `<dir>/userdata`                                                                        |

`--home` wins over the worktree default, which wins over an ambient `OTTER_HOME`: an
inherited variable pointing at `~/.otter` would otherwise put a branch on the installed
app's database, and the dev runner refuses the installed app's home outright. The rules live in
`apps/desktop/src/paths.ts`, `apps/desktop/scripts/dev-home.mjs` and `scripts/dev-data.ts`. Before the rename to Otter the home was `~/.otter-mail`
(`<worktree>/.otter-mail`, `OTTER_MAIL_HOME`): where one exists it stays the home, never moved
(Claude files its chats under the workspace's real path).

A state directory holds the mail cache (`mail-cache.db`), accounts, Google tokens
(`google-tokens.json`, encrypted with a Keychain key), settings, views, keybindings, Chromium's
profile in `chromium/` and logs in `logs/main.log`. Delete it to start fresh.

- Each state directory signs in to its accounts separately. Dev runs are named
  "Otter (Dev)" and use their own Keychain key ("Otter Mail (Dev) Safe Storage": the app keeps the
  key it had before the rename, `apps/desktop/src/paths.ts`), so they can't read the installed
  app's tokens. `:real` is the exception (below).
- Renderer logs are in the DevTools console (View → Toggle Developer Tools).

## Demo mailboxes

`pnpm dev:demo` (the web app) and `pnpm dev:desktop:demo` (the desktop app) open on real mailboxes
made for development, already added, past the setup: the dedicated `otterware.demo@gmail.com`
Google account (synthetic mail, contacts and calendar events), a dedicated Outlook (Microsoft)
account set up the same way, and the local IMAP server's
`me@otter.test` ([IMAP locally](#imap-locally), started for you; it needs Docker). They keep their
own data, apart from the mailboxes you develop with: the Mac app in a `demo/` data home, the web
app in its own OPFS storage (`.otter-mail-dev-demo`, `dev-demo-files/`), signed in to an Otter
account of the demo's address on the local relay.

One variable in the main checkout's ignored `.env.local` holds them, a JSON list
(`packages/contracts/src/demo.ts`):

```dotenv
OTTER_DEMO_MAILBOXES='[{"provider":"gmail","email":"otterware.demo@gmail.com","password":"…","refreshTokens":{}},{"provider":"outlook","email":"…@outlook.com","password":"…","refreshTokens":{}}]'
```

Once per machine, `pnpm dev:desktop:demo --login` and `pnpm dev:demo --login` sign the Gmail
mailbox in to Google (Google's page, in your browser; the password is there) and save each
sign-in in the list, one per OAuth client: the Mac app's, and the relay's web client, which comes
back to `http://localhost:8787/v1/gmail/callback` (so no other `pnpm dev` may hold that port
then). The Outlook mailbox signs in to Microsoft the same way: the Mac app's public client
(`OTTER_MICROSOFT_CLIENT_ID` in `.env.local`), and the relay's web client
(`MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` in `infra/relay/.dev.vars`), coming back to
`http://localhost:8787/v1/outlook/callback`, which the app registration must list. Microsoft's
sign-ins lapse after 90 days unused: `--login` again then. `--login` signs in the mailboxes that
have no sign-in for that app yet, or every one when none is missing. Copying `.env.local` to another machine
brings them along. An IMAP entry is
`{"provider":"imap","email","password","imap":{"host","port","security"},"smtp":{…}}`.

How they get in, in development only:

- The dev runner reads the list, adds the local IMAP server's mailbox and hands it to the app as
  `OTTER_DEMO_MAILBOXES`.
- Core's `addDemoMailboxes` adds those the app doesn't have yet before the windows ask for any.
  The Mac app refreshes the saved Google (or Microsoft) sign-in itself; the web app has the local
  relay seal it, as its sign-in popup would.
- The web app gets the list from its Vite dev server (`/__dev/demo-mailboxes`), never a build.
  The local relay runs with `DEV_DEMO=true` (never in `wrangler.jsonc`), which opens
  `/v1/dev/session` (an Otter session for an address, without Google), `/v1/dev/gmail` and
  `/v1/dev/outlook`.

New T3 worktrees symlink `.env.local` during setup; the dev runner falls back to the main
checkout's (the parent of `git rev-parse --path-format=absolute --git-common-dir`). Keep the
password and sign-ins out of commits, logs, screenshots and app bundles, and never give them a
`VITE_` prefix. Preserve the seeded reviewer data, and send test mail only to
`otterware.demo@gmail.com` itself (or between it and the Outlook demo mailbox); the fixtures'
`otter.example` addresses are fictional.

## Google sign-in

Accounts sign in through the browser with PKCE and a loopback redirect (`127.0.0.1`), using the
"Desktop app" OAuth client of the `otterware` Google Cloud project. The client ID and secret are
baked in at build time and never committed: copy `.env.example` to `.env.local` and fill them in
(Credentials: https://console.cloud.google.com/auth/clients?project=otterware). The same
`OTTER_GOOGLE_CLIENT_ID` / `OTTER_GOOGLE_CLIENT_SECRET` variables override the baked-in
values at runtime.

Outlook mailboxes sign in the same way (`apps/desktop/src/services/microsoft-oauth.ts`), with a
public client of an Azure app registration: no secret, PKCE, and a loopback redirect on
`http://localhost` (any port, under "Mobile and desktop applications"; "Allow public client
flows" on). Its Application (client) ID is `OTTER_MICROSOFT_CLIENT_ID`, baked in and
overridable like Google's; without one the app doesn't offer Outlook. The web app signs in to
Outlook through the relay instead.

The same client signs in to the Otter account (`infra/relay`): with a Gmail account already on the
Mac, the app proves the identity with a fresh ID token from that account's refresh token, no
browser needed; otherwise it runs the same browser flow with identity scopes only.
`OTTER_RELAY_URL` points the app at another relay (e.g. `http://127.0.0.1:8787` for
`pnpm --filter @otter/relay dev`).

The consent screen is published but not yet verified by Google, so sign-in shows an "unverified
app" warning and is capped at 100 users. The home page, privacy policy and terms it links to are
on https://otterware.app/mail/ (the `website` repository); the web app, at
https://otter.otterware.app, is `site/`, which the Release workflow deploys with each nightly and
stable release (docs/runbook.md).

## The web app

The same renderer runs in a browser, with the mail backend (`packages/core`) in a Web Worker
(`apps/web/src/web`). It needs an Otter account, so `pnpm dev` runs a local relay next to it
(applying the relay's local D1 migrations first) and points the app at it:

```sh
# once (gitignored): the relay's secrets
printf 'BETTER_AUTH_SECRET=any-long-local-secret\nGOOGLE_GMAIL_CLIENT_SECRET=...\n' > infra/relay/.dev.vars
pnpm dev    # the app on http://localhost:5833, the relay on http://localhost:8787
```

Signing in with Google locally uses the web OAuth client from `wrangler.jsonc`, whose redirect
URIs include `http://localhost:8787/...`, so it works in the main checkout (worktrees' relays sit
on another port). The browser's data (the mail
cache and files) lives in the site's OPFS storage: clear site data to start fresh.

## IMAP locally

`pnpm imap-server` (Docker) runs a mail server on this machine to add as an IMAP mailbox:
Dovecot, as in core's protocol tests, with special-use folders and a few seeded threads for
`me@otter.test`, and Mailpit catching what it sends (http://localhost:8025). It prints the
settings to enter: password `pass`, IMAP on `localhost` port 31993 (TLS), SMTP on 31465 (TLS).
`pnpm imap-server down` stops it and drops its mail: the next run starts from the seed again.

Both apps verify certificates, so the server's comes from a dev CA made once in
`~/.otter/dev-mail/`, shared by every checkout (one server serves them all). The dev runner
trusts it when it exists, and only there:

- `pnpm dev`: the web app's TLS (`apps/web/src/web/tls.ts`) adds it to Mozilla's roots through
  `VITE_DEV_MAIL_CA`, read in dev builds only. The local relay runs with
  `TUNNEL_ALLOW_PRIVATE=true`, which lets its tunnel reach `localhost` and any port; the
  production relay (`wrangler.jsonc`) never sets it and allows only mail ports on public hosts.
- `pnpm dev:desktop`: `NODE_EXTRA_CA_CERTS`, which the desktop app's backend process honors.

The web app still needs an Otter account to open the tunnel (sign in as usual). Delete
`~/.otter/dev-mail/` and rerun `pnpm imap-server` for a new CA.

## Agent gateways

`pnpm agents-server` starts a real OpenClaw gateway and a real Hermes gateway in Docker, each
running the Otter plugin from this checkout (`extensions/openclaw/gateway`,
`extensions/hermes/gateway`), so a plugin change is tested without publishing it or touching a
gateway someone uses. Name one to start only that: `pnpm agents-server openclaw`.

`pnpm dev:demo --agents openclaw,hermes` (or `dev:desktop:demo`) starts the ones it names and
opens the app already connected to them, then stops the checkout's gateways when the run ends.
Without `--agents` a demo run starts none: OpenClaw takes over a gigabyte of memory and about
half a minute to start (a few minutes the first time).

- **A pair per checkout.** Each checkout has its own containers, data and ports (OpenClaw on
  41000 and Hermes on 45000, plus the checkout's port offset), so two worktrees test two versions
  of a plugin at the same time. Both listen on 127.0.0.1 only, behind a key made once for this
  computer (`dev-agents-key` in `~/.otter`), as a web page can reach a port on localhost.
  A checkout's dev runs share its pair: ending one stops the gateways for the others.
- **The web app pairs with OpenClaw once.** The desktop app connects by itself. OpenClaw never
  pairs a browser without asking, so the web app's first connection waits: run
  `pnpm agents-server approve` and reload the page.
- **A plugin change needs a restart.** Run the command, or the dev run, again: it restarts the
  gateways, which load the plugins as they are now. The gateways' own versions are pinned in
  `scripts/agents-server/compose.yaml`; raise them with the plugins.
- **They run on your Codex sign-in.** Sign in once with `codex login`. Each start gives the
  gateways Codex's current access token and never its refresh token: Codex on this computer
  stays the only one that renews the sign-in, as a second holder of the refresh token would
  rotate it and sign the other out. The token lasts some days; when a gateway says it has run
  out, start `codex` once and run the command again. What the gateways do counts against your
  ChatGPT plan. OpenClaw's calls (Talk with OpenClaw in a chat) use the same sign-in, with
  OpenAI's GPT-Live voice.
- **What a plugin tells the relay.** The gateways start without a relay, so a delivery or a
  finished run tells no one. To see what a plugin sends, run a recorder on this computer:

  ```sh
  node -e 'require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c).on("end",()=>{console.log(q.url,b);s.writeHead(202).end()})}).listen(48787)'
  ```

  Then point the channels at it, with any token that starts with `otter_ch_`. For OpenClaw, run
  `docker exec <checkout's openclaw container> sh -c 'cd /app && node openclaw.mjs config set
channels.otter.relayUrl http://host.docker.internal:48787 && node openclaw.mjs config set
channels.otter.token otter_ch_dev'` (`docker ps` names the container). For Hermes, add
  `OTTER_RELAY_URL=http://host.docker.internal:48787` and `OTTER_CHANNEL_TOKEN=otter_ch_dev` to
  `/opt/data/.env` in its container. Drive them from inside the containers:

  - OpenClaw: `node openclaw.mjs agent --session-key agent:main:otter-mail:<id> --message …`
    ends a run in an Otter chat. `node openclaw.mjs gateway call sessions.patch --params
'{"key":…,"label":…}'` titles the chat the way Otter does. `node openclaw.mjs message send
--channel otter --target chat:new --message …` is a delivery.
  - Hermes: `hermes send -t otter:new …` is a delivery.

  Remove the settings afterwards (`config unset`, and delete the lines from the `.env`). Otherwise
  the gateways keep posting to a recorder that's gone.

`pnpm agents-server down` removes the checkout's containers; `down --volumes` also forgets their
chats and settings, which is how to clean up before deleting a worktree.

## Made-up mailbox

`pnpm dev:fake` (the web app, alone, with `VITE_DEMO=1`) and `pnpm dev:desktop:fake` open on
made-up mail: no relay, no Google, Microsoft or Otter account. The backend (the web app's Worker,
the desktop app's backend process) puts pretend services in front of `fetch` (`packages/core/src/fake`:
Gmail with its Calendar, Outlook and Todoist), seeded with two Gmail mailboxes, "Personal" (`demo@otter.example`) and "Work" (`sam@acme.example`): a few weeks
of threads, newsletters with unsubscribe links, attachments, calendar invitations, drafts, spam
and trash, and plenty of non-ASCII names. Use it to build and test without your own accounts.

- Archiving, labels, stars, trash, sending and drafts change the pretend mailbox and go into its
  history feed, so sync behaves as it does against Gmail. Search knows the common operators
  (`in:`, `is:`, `label:`, `category:`, `from:`, `has:attachment`, …) plus free text.
- Calendar RSVPs go out as email replies (no calendar); avatars fall back to initials; the Otter
  account (signing in, devices, synced preferences) is unavailable.
- On the web it keeps its own storage (OPFS `.otter-mail-demo` and `demo-files/`, lock and
  channel `otter-mail-demo`), apart from real mail on the same origin; add `?reset-demo` to the
  address to start over (close other tabs of it first). The desktop app keeps it in its `fake/`
  home; `--reset` starts it over.
- Real builds leave all of it out: `__DEMO__` is `false` unless `VITE_DEMO=1`, and a packaged
  desktop app ignores `OTTER_DEV_DATA`.

## Your own data

`pnpm dev:desktop:real` runs the desktop app on a copy of the one installed on this computer
(`scripts/installed-app.ts`), set up as you have it: your mailboxes and calendars signed in,
your views, settings, agents and their connections, chats and Otter Drive. It's for reproducing
what only your data shows. Use it only when you mean to, and when an agent works in it, only
because you asked: it reads and changes your real mail.

- The first run copies the installed app's data into the `real/` home; `--reset` copies it again.
  Nothing is ever written back to the installed app.
- Your Otter account stays behind (its session is dropped from the copied secrets), so nothing
  syncs to the account or your other devices. So do the browser's profile, caches, logs, the
  scheduled sends (the installed app sends them), its push watches and launch at login.
- The sign-ins are sealed under the installed app's Keychain key, so this run uses that key
  (`OTTER_DEV_DATA=real`, `apps/desktop/src/paths.ts`): macOS asks once to let "Otter (Dev)" use
  "Otter Mail Safe Storage" (Always Allow). They only refresh with the OAuth clients that made
  them, so the run uses the installed app's, read from its bundle.
- Sending, deleting, archiving, unsubscribing and RSVPs reach your real mailboxes and the people
  in them, as in the installed app.

`pnpm --filter @otter/site build` assembles the deployable site (the web app) in
`site/dist`.

## Open-source licenses

What Otter is built on is listed in the app with its licenses (Settings → General → About; Settings
on the iPhone), and credited in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The list is
generated (`scripts/lib/third-party-licenses.ts`, T3 Code's):

- The web build writes `third-party-licenses.json` beside `index.html`, for the web and the
  desktop app: every installed production dependency of `apps/web` and `apps/desktop`, through
  the workspace packages they use, with the license text its package ships. The dev server
  answers the same path.
- `pnpm ios:resources` writes the iPhone apps' `Licenses.json`.

`third-party-licenses.config.json` holds what a package can't say for itself:

- `customNotices`: what didn't come from npm, such as code ported from another project, a font,
  an image, a Swift package. `bundles` says which apps list it (`web`, `desktop`, `ios`). Give it
  `generatedNotices` (an SPDX license id, with `copyrights` and a `preamble`) or a `noticeFile`.
- `packageOverrides`: a package whose archive has no license file. The build fails on one and
  names it; add its license and copyright line here.

License texts come from the SPDX templates in `third-party-licenses/spdx/`, committed so a build
never fetches them. After naming a license that has no template yet, run `pnpm licenses:sync`
and commit the file it downloads.
