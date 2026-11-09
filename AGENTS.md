# Otter

Otter is your daily work, with your agents: mail, calendar, files and tasks in one calm app,
and the user's own agents working across them. An Electron app for macOS and Linux (Debian and
Ubuntu, a .deb), and the same app in the browser at https://otter.otterware.app. It is laid out
like Otter Code (our fork of T3 Code): a pnpm monorepo built with Vite+ (`vp`); the desktop app
ships through GitHub Releases with auto-update.

In product copy (the app, the README, otterware.app) the words are: **modules** (Mail,
Calendar, Drive, Tasks; Code soon), **plugins** (what `extensions/` are: features, UI and agent
tools for a module, bringing its connectors), **connectors** (Gmail, Outlook, IMAP, Google
Calendar, Todoist, Otter Drive, an OpenClaw gateway, Hermes), the user's **agents** over all of
it, and **Scheduled** for what agents run on a schedule. Never "Otter Mail" for this app (the
iPhone app keeps that name), "products", or "automations".

What each app supports (Mac, Linux, web, iPhone; Gmail vs IMAP vs Outlook): `docs/features.md`. Keep it current
when a feature lands or goes.

## Where code lives

- `packages/core`: the mail backend, shared by both apps: its mail providers (`src/providers`:
  Gmail's API, IMAP, Outlook through Microsoft Graph; docs/imap.md, docs/outlook.md), quota, the SQLite
  mail cache, sync, the JSON stores, the Otter account (better-auth client), mailboxes synced
  across devices, realtime push, and the handlers the UI calls. It is plain TypeScript: anything
  platform-specific goes through the `Platform` interface (`src/platform.ts`).
- `apps/desktop`: the Electron main process (`src/main.ts`: windows, menus, the Dock,
  updates), the preload, and the mail backend: core in a utility process (`src/backend.ts`) with
  the desktop platform (`src/platform.ts`: node:sqlite, and safeStorage, dialogs and
  notifications asked of main). Main forwards the windows' invokes to it (`src/backend-host.ts`,
  messages in `src/backend-protocol.ts`), so syncing never holds up the app itself.
  - `src/os/`: everything that differs between macOS and Linux, behind one interface
    (`types.ts`: `HostOS` for main, `BackendOS` for the backend) that `mac/` and `linux/`
    implement: window frame, menu, badge, login items, secrets, default mail app,
    terminals, updates. `features.ts` is what each OS's app shows (`desktopBridge.features`).
    The rest of the app asks `hostOS` / `backendOS` and never checks `process.platform`.
  - `src/handlers/`: the desktop-only handlers (default mail app, …); `backend.ts` there holds
    the ones the backend serves.
  - `src/services/`: Google and Microsoft sign-in (loopback OAuth), the
    browser (`browser.ts`: its session, the Web Store, popups and permissions; `extensions.ts`
    with `src/extensions-preload.ts`: Chrome's extension APIs Electron lacks), the local agents
    (Claude, Codex; Hermes is in core) and the MCP server that gives them, and other agents on
    the Mac with a token, Otter's tools, default mail app.
  - `src/windows/`: the main window, and where its pages load from.
  - `src/updates.ts`: electron-updater against GitHub Releases.
- `apps/web`: the React renderer, one build for both apps. `index.html` is the main window.
  UI primitives live in `src/components/ui/`. `src/main/mail/` is the mail UI for every
  provider (sidebar, lists, reader, composer); it gates on the mailbox's capabilities.
  Where the main window is (mailbox, label, conversation, Settings pane) is its route
  (`src/main/router.tsx`, TanStack Router): in the hash in the desktop app, real paths on the web
  (`/mail/you@gmail.com/INBOX/<id>`, `/agents/<id>`, `/calendar/week`, `/settings/appearance`; `src/main/places.ts`;
  addresses from before the rename, without `/mail` or with `/chats`, redirect).
  `src/main/browser/` is the browser (Mac): the panel of `<webview>` tabs beside the mail, a
  chat's pages in the AI workspace, and `openLink`, where links from mail and chat go.
  The agents' UI is `src/main/agent/`: the chats (`chat-store.ts`, synced through core), shown in the
  small window over the mail (⌘I, `chat-window.tsx`) or the AI workspace, the Chats space
  (`/agents/<id>`, `chat-workspace.tsx`), with what each chat used and made as tabs.
  `src/web/` is the browser shell: core in a Web Worker (SQLite WASM on OPFS) hosted by one
  tab for every open tab (`backend.ts`), and the bridge that stands in for the preload. What only the desktop app has is off in `desktopBridge.features`.
  What the computer is called in copy (Mac / computer) is
  `src/main/os-names.ts`; shortcuts in copy go through `shortcutText("mod+k")` (⌘K, Ctrl+K).
- `apps/ios`: Otter Mail for iPhone (the iPhone app keeps that name), a native SwiftUI app (iOS 27, Liquid Glass):
  mail with the Calendar and Tasks modules beside it (tasks kept on the iPhone, not synced). Linear's
  layout (a glass bar: Mail, Calendar, Tasks, ⌃⌄ for what the one in front is scoped by; the agent
  on its own button), Otter Code's list rows. Its own Swift code, not the TypeScript core: it signs in to Google itself (the "iOS"
  OAuth client, PKCE), talks to Gmail directly, caches on disk, and follows the Otter account
  through the relay (mailboxes, preferences under the same keys, live events). `Resources/` holds
  the themes and demo mailbox, exported from `packages/shared` by `pnpm ios:resources`. See its
  README.
- `extensions/`: the built-in extensions, a package each (VS Code's model; contracts'
  `src/extensions.ts`): Sign-in codes, Calendar invites, Translation, Todoist, Otter Drive, and
  the agents (`openrouter`, the Otter agent; `hermes`, `openclaw`, `claude`, `codex`). Each
  `package.json` carries its manifest (`otter`); its halves are `./core` (`activate(context)`:
  handlers, an agent; core's `src/extensions.ts`), `./ui` (what it contributes to the screens'
  slots: cards, actions, commands, settings, an agent's form, a workspace; `apps/web/src/main/extensions`;
  Settings lists them by manifest `category` in Agents, Connections (services you sign in to,
  beside the mailboxes: Todoist, Otter Drive), Integrations (hidden while empty) and Features, each with a
  page) and
  `./desktop` (Claude, Codex). A workspace (Otter Drive's Drive) is declared in the manifest's
  `contributes.workspaces` (VS Code's view containers: known without running it) and drawn by the
  `./ui` half: a mode beside Mail, Calendar and Agent at `/<id>/<location>/<item>`, with its own
  sidebar and main area (`extensions/workspaces.ts`). The manifest's `platforms` (mac, linux, web; absent: all) says where one runs, and each
  app loads the half it can run, as VS Code loads `main` or `browser`: the desktop app `./desktop`
  when there is one, else `./core`; the web app `./core`. Core doesn't import them: the shells pass
  their list to `startCore`
  (`apps/desktop/src/extensions.ts`, `apps/web/src/web/extensions.ts`), the renderer lists the
  `./ui` halves (`extensions/registry.ts`). Extensions reach the app only through the kits
  (`@otter/core/extension-kit`, `@otter/web/extension-kit`,
  `@otter/desktop/extension-kit`; the last two are aliases), which lint enforces. An agent is
  the strict contribution: core's `ChatProvider` (its settings are its own, under its id) and, in
  the renderer, its icon and settings form; the chat UI is shared.
- `packages/contracts`: types shared by both sides, including `DesktopBridge`, the
  `window.desktopBridge` API the preload exposes, and the relay's API (`src/relay.ts`).
- `packages/shared`: what every app shows the same, the iPhone app included: the color themes
  (`./themes`) and the demo mailbox (`./demo-mailboxes`). The web app imports it; the iPhone app
  bundles it as JSON.
- `infra/relay`: https://relay.otterware.app (and https://relay.mail.otterware.app, for clients from
  before the rename; `src/hosts.ts`), a Cloudflare Worker (Hono, better-auth,
  Drizzle on D1, a Durable Object per user). Otter accounts, the Gmail accounts linked to them,
  the account's preferences (core's `services/preferences.ts` syncs them), its agent chats (core's
  `services/chats.ts`, transcripts included, so every device reads every chat), and realtime
  mail: Gmail → Pub/Sub → relay → WebSocket to each signed-in device. Opt-in background
  notifications use encrypted limited Gmail/Outlook grants (or an IMAP password) to verify
  unread arrivals and renew watches; APNs carries routing IDs and generic text, and the iPhone
  enriches directly from the provider. The optional OpenRouter agent processes and stores chats
  and mail/calendar tool results on the relay. The web app's Gmail tokens pass through it (never
  stored), the desktop app's never do. See its
  README.
- `native/translator`: a Swift command-line helper for Apple's on-device Translation. It reads a
  JSON request on stdin and prints JSON. Building it needs full Xcode (macOS 26 SDK).
- `scripts/`: dev runner, desktop packaging (`build-desktop-artifact.ts`), release helpers.
- `assets/`: app icons like Otter Code's: `prod/` for stable, `nightly/` for the night sky, and `dev/`
  for the blueprint. The iPhone has stable and dev icons. The desktop and web app are drawn from
  Otterware's mark, `prod/otterware-symbol.svg`; the iPhone app (still Otter Mail) from
  `prod/otter-mail-symbol.svg`. `pnpm icons:export` regenerates them all.
  `agent/` is Otterware's agent (the Pilot): the app draws it with `AgentIcon`
  (`apps/web/src/main/agent/agent-icon.tsx`), the iPhone with its `OtterAgent` image.
- `changelog/`: notes on Mac and web releases (`<version>.md`, images in `images/`), shown on
  otterware.app/mail/changelog (the website repository copies them hourly) and on the version's
  GitHub Release (workflows copy it there); the app only links there. A note is marketing, written only when the user asks for one (the
  `write-changelog` skill). Format in `packages/shared/src/changelog.ts`.
- `site/`: https://otter.otterware.app (mail.otterware.app redirects there), a Cloudflare Worker: the web app, at `/` and any other
  page that isn't a file (the app's own routes). Otter's page, privacy policy and terms are
  on https://otterware.app/mail/ (the `website` repository, with every Otterware app's page);
  their old addresses here redirect there.
- Errors: Sentry, scrubbed, from the desktop app, the web app and the relay
  (`packages/shared/src/error-reports.ts`; docs/error-reports.md). Log with `logger.error`
  or `logger.failure` and pass the Error: that's what gets reported. A fix for a reported issue
  says `Fixes <SHORT-ID>` in its commit or PR, so Sentry resolves it with the release.
- Deploys: Cloudflare Workers Builds deploys `infra/relay` on pushes to `main` that touch it;
  the Release workflow deploys `site/` with each release (below). GitHub Actions smoke-tests the
  relay every 6 hours (keyless Google Cloud access).

## How the pieces talk

The app is local-first: it talks to Gmail directly and renders from its SQLite cache. The Otter
account (the user button by Back in Settings) is who you are; mailboxes are the Gmail accounts
it holds, which follow you to every device, with push from the relay. The desktop app works without
it; the web app needs it (the relay keeps its Gmail sign-ins alive).

- Renderer → backend: `window.desktopBridge.invoke(channel, params)` → a handler registered with
  core's `handle(channel, …)` (served over Electron IPC, or Worker messages on the web), or an
  `ipcMain.handle` for the Mac-only ones.
- Backend → renderer: `broadcast(channel, params)` → `window.desktopBridge.on(channel, listener)`.
- Keep channel names stable; both sides refer to them by string.
- Renderer code never touches Electron, Node or the backend directly. Anything new goes through a
  handler; anything platform-specific in core goes through the Platform.

## Dev

- `pnpm install`, then a dev command: an app and what it opens on (`scripts/dev-runner.ts`;
  [What a dev run opens on](docs/development.md#what-a-dev-run-opens-on)). `pnpm dev` runs the
  web app on :5833 with a local relay on :8787 (open it in a browser, e.g. the T3 preview);
  `pnpm dev:desktop` the desktop app (Vite dev server + main-process watcher + Electron with
  reload). Both render the same `apps/web`, so UI work is checked in the browser. Their data:
  - (nothing): an empty sandbox.
  - `:fake` (`pnpm dev:fake`, `pnpm dev:desktop:fake`): made-up mailboxes from pretend Gmail,
    Outlook and Todoist (`packages/core/src/fake`), no accounts, no network. Build and test
    against it; see the `test-otter` skill (`.agents/skills`).
  - `:demo` (`pnpm dev:demo`, `pnpm dev:desktop:demo`): the demo accounts, already added: the
    dedicated `otterware.demo@gmail.com` Google account, an Outlook one and the local IMAP
    server's (`pnpm imap-server`, started for you). For real Gmail, Google OAuth, Contacts, Calendar
    or IMAP checks. They come from `OTTER_DEMO_MAILBOXES` in the main checkout's ignored
    `.env.local` (shared with T3 worktrees by symlink); `--login` signs them in once per machine.
    Preserve the demo fixtures and send test mail only to the demo accounts themselves. Keep
    credentials out of logs, commits, screenshots and app bundles. See
    [Demo mailboxes](docs/development.md#demo-mailboxes).
  - `:real` (`pnpm dev:desktop:real`): a copy of the user's installed desktop app, signed in to
    their own mail, calendars and agents, without their Otter account. Run it only when the user
    asks for it. It is their live mail: read freely, but never send, reply, delete, archive,
    unsubscribe, RSVP, change settings on a server or anything else lasting unless they say so
    for that action. Don't screenshot or quote their mail beyond what the task needs. See
    [Your own data](docs/development.md#your-own-data).
- `pnpm dev:ios`: the iPhone app in the simulator (it has the same demo mailbox, from the welcome
  screen).
- `pnpm start` runs the built app unpackaged; `pnpm dist:desktop:dmg` builds a DMG in `release/`
  (on a Mac), `pnpm dist:desktop:deb` a .deb (on Linux).
- Data homes (`apps/desktop/src/paths.ts`, as in T3 Code): the installed app uses
  `~/.otter/userdata` (`~/.otter-mail/userdata` for installs from before the rename, never
  moved); dev runs use `~/.otter/dev`, or `<worktree>/.otter` in a linked worktree, and a
  `<kind>/` home beside it for `:fake`, `:demo` and `:real`. `--home <dir>` overrides and
  `--reset` starts one over. Never point dev at the installed app's home (the runner refuses).
- Main-process logs: the terminal, and `logs/main.log` in the state directory.

## Releases

The desktop app (Mac and Linux) and the web app have stable and nightly channels.
The iPhone app releases separately, with its own version:

- Mac and Linux: the Release workflow publishes a nightly on every push to main (each merge).
  Run it with `channel=nightly` for an immediate nightly, or `channel=stable` to promote the latest published
  nightly commit (an optional stable version overrides its previewed version). A `vX.Y.Z` tag
  releases that exact commit. Each release builds the DMG and .debs (x64, arm64). Settings → General
  selects Stable or Nightly on this computer; updates offer "Restart to update" in the sidebar.
  Both channels use the same app identity and data; their icons change with the installed build.
  A release never needs a changelog note: don't write one, or ask about one, unless the user asks.
- Web: each release deploys it too: a nightly, once its checks pass, to the
  `otter-mail-site-nightly` Worker; a stable release, after its GitHub Release, to otter.otterware.app. Both answer at
  otter.otterware.app (one browser cache and sign-in): Settings → General's channel sets a
  cookie the stable Worker routes on (`site/src/worker.ts`); open tabs offer "Reload to update".
- iPhone: run the Release iPhone workflow from `main` when `apps/ios` (or what it bundles from
  `packages/shared`) has changed. It uploads to TestFlight and tags `ios-vX.Y.Z`.

`docs/runbook.md` is the short version of shipping each part; details in `docs/release.md`.

## Verifying

Before handing work back, run and fix:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm fmt`

For UI or behavior changes, run the app and check the change in it, at a 1600x1000 viewport.
For the iPhone app, build it (`pnpm dev:ios`, or `xcodebuild` as its README shows) and check the
change in the simulator, in light and dark.

Pull requests follow the `pr` skill (`.agents/skills`): a PR that changes what users see carries
screenshots or a recording, attached with `gh pr create --attach`.

## Taste

- Small, obvious code. Don't add machinery a change doesn't need.
- Match the surrounding code: its naming and idioms.
- Be aggressive about removing useless code comments, and avoid adding them. Skip narration,
  file introductions, section dividers, and comments that repeat names or nearby code. Keep
  tooling directives, required attribution, and explanations of non-obvious constraints,
  invariants or workarounds.
- The mail cache is local-first: the UI renders from SQLite and sync catches up. Keep IPC
  payloads small and never block the renderer on Gmail.
- The desktop app targets macOS (Apple Translation, the Dock badge) and Linux (Debian first:
  xdg); the web app runs in current browsers. Put what
  differs by OS in `apps/desktop/src/os`, gate UI with `features`, never with ad-hoc checks.
- Each app shows only what works on it. Hide what it doesn't have; don't show it disabled or
  labeled "Available in the Mac app" (an error explaining why something just failed may say so).
