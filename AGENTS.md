# Otter Mail

Otter Mail is a calm, fast Gmail client: an Electron app for macOS and Linux (Debian and
Ubuntu, a .deb), and the same app in the browser at https://mail.otterware.app. It is laid out
like Otter Code (our fork of T3 Code): a pnpm monorepo built with Vite+ (`vp`); the desktop app
ships through GitHub Releases with auto-update.

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
  core's RPC protocol below), so syncing never holds up the app itself.
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
    the Mac with a token, Otter Mail's tools, default mail app.
  - `src/windows/`: the main window, and where its pages load from.
  - `src/updates.ts`: electron-updater against GitHub Releases.
- `apps/web`: the React renderer, one build for both apps. `index.html` is the main window.
  UI primitives live in `src/components/ui/`. `src/main/mail/` is the mail UI for every
  provider (sidebar, lists, reader, composer); it gates on the mailbox's capabilities.
  Where the main window is (mailbox, label, conversation, Settings pane) is its route
  (`src/main/router.tsx`, TanStack Router): in the hash in the desktop app, real paths on the web
  (`/you@gmail.com/INBOX/<id>`, `/all/inbox`, `/settings/appearance`).
  `src/main/browser/` is the browser (Mac): the panel of `<webview>` tabs beside the mail, a
  chat's pages in the AI workspace, and `openLink`, where links from mail and chat go.
  The agent's chats are `src/main/mail/chat-store.ts` (synced through core), shown in the
  small window over the mail (⌘I, `chat-window.tsx`) or the AI workspace, the Chats space
  (`/chats/<id>`, `chat-workspace.tsx`), with what each chat used and made as tabs.
  `src/web/` is the browser shell: core in a Web Worker (SQLite WASM on OPFS) hosted by one
  tab for every open tab (`backend.ts`), and the bridge that stands in for the preload. What only the desktop app has is off in `desktopBridge.features`.
  What the computer is called in copy (Mac / computer) is
  `src/main/os-names.ts`; shortcuts in copy go through `shortcutText("mod+k")` (⌘K, Ctrl+K).
- `apps/mobile`: Otter Mail for iPhone, an Expo app (React Native, iOS 26+, Liquid Glass through
  SwiftUI) laid out like Otter Code's `apps/mobile`, shipped as `dev.otterware.mail`:
  `packages/core` itself runs on the phone, on a worklets worker runtime in Bundle Mode, its I/O
  through the Nitro modules in `modules/` (SQLite, mail sockets, URLSession, the Keychain); the UI
  reaches it through the `CoreHost` Effect service. `native/` is the notification service
  extension's Swift (a config plugin adds its target at prebuild). See its README.
- `extensions/`: the built-in extensions, a package each (VS Code's model; contracts'
  `src/extensions.ts`): Sign-in codes, Calendar invites, Translation, Todoist, Otter Drive, and
  the agents (`openrouter`, the Otter Mail agent; `hermes`, `openclaw`, `claude`, `codex`). Each
  `package.json` carries its manifest (`otterMail`); its halves are `./core` (`activate(context)`:
  handlers, an agent; core's `src/extensions.ts`), `./ui` (what it contributes to the screens'
  slots: cards, actions, commands, settings, an agent's form, a workspace; `apps/web/src/main/extensions`;
  Settings lists them by manifest `category` in Agents, Connections (services you sign in to,
  beside the mailboxes: Todoist, Otter Drive), Integrations (hidden while empty) and Features, each with a
  page) and
  `./desktop` (Claude, Codex), and `./mobile` for the Expo app (Sign-in codes' and Calendar invites' reader cards, through `@otter-mail/mobile/extension-kit`). A workspace (Otter Drive's Drive) is declared in the manifest's
  `contributes.workspaces` (VS Code's view containers: known without running it) and drawn by the
  `./ui` half: a mode beside Mail, Calendar and Agent at `/<id>/<location>/<item>`, with its own
  sidebar and main area (`extensions/workspaces.ts`). The manifest's `platforms` (mac, linux, web, ios; absent: all but ios, which an extension names to opt in) says where one runs, and each
  app loads the half it can run, as VS Code loads `main` or `browser`: the desktop app `./desktop`
  when there is one, else `./core`; the web app `./core`. Core doesn't import them: the shells pass
  their list to `startCore`
  (`apps/desktop/src/extensions.ts`, `apps/web/src/web/extensions.ts`), the renderer lists the
  `./ui` halves (`extensions/registry.ts`). Extensions reach the app only through the kits
  (`@otter-mail/core/extension-kit`, `@otter-mail/web/extension-kit`,
  `@otter-mail/desktop/extension-kit`; the last two are aliases), which lint enforces. An agent is
  the strict contribution: core's `ChatProvider` (its settings are its own, under its id) and, in
  the renderer, its icon and settings form; the chat UI is shared.
- `packages/contracts`: types shared by both sides, including `DesktopBridge`, the
  `window.desktopBridge` API the preload exposes, the relay's API (`src/relay.ts`), and core's
  protocol with the app hosting it (`src/rpc.ts`, Effect Schema and `effect/rpc`: invokes,
  broadcasts, the host's requests and effects), over any copying message port (`src/rpc-port.ts`:
  the utility process, the web Worker, later the phone's runtime). Core serves it (`serveCore`).
- `packages/client-runtime`: what every client does the same, Otter Code's layout (subpath
  exports only, no React or DOM): the connection to core (`connection`, `rpc`), state as Effect
  atoms (`state/chats`, `state/messages`, `state/mailboxes`), mail writes with their overlays and
  undo (`operations`), and pure helpers. The web app reads its atoms with `@effect/atom-react`
  (chats and the mailbox lists so far; other data is still TanStack Query).
- `packages/shared`: what every app shows the same, the iPhone app included: the color themes
  (`./themes`) and the demo mailbox (`./demo-mailboxes`). The web app and the iPhone app import it.
- `infra/relay`: https://relay.mail.otterware.app, a Cloudflare Worker (Hono, better-auth,
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
  for the blueprint. The iPhone has stable and dev icons, each in light, dark and tinted. Every icon is drawn from
  the one mark, `prod/otter-mail-symbol.svg`: `pnpm icons:export` regenerates them all.
  `agent/` is Otterware's agent (the face): the app draws it with `AgentIcon`
  (`apps/web/src/main/mail/agent-icon.tsx`), the iPhone with `apps/mobile/assets/agent.png`.
- `changelog/`: notes on Mac and web releases (`<version>.md`, images in `images/`), shown on
  otterware.app/mail/changelog (the website repository copies them hourly) and on the version's
  GitHub Release (workflows copy it there); the app only links there. A note is marketing, written only when the user asks for one (the
  `write-changelog` skill). Format in `packages/shared/src/changelog.ts`.
- `site/`: https://mail.otterware.app, a Cloudflare Worker: the web app, at `/` and any other
  page that isn't a file (the app's own routes). Otter Mail's page, privacy policy and terms are
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

- `pnpm install`, then `pnpm dev`: the web app on :5833 with a local relay on :8787 (open it in
  a browser, e.g. the T3 preview). `pnpm dev:desktop` runs the desktop app (Vite dev server +
  main-process watcher + Electron with reload); `pnpm dev:web` the web app alone. Both apps render
  the same `apps/web`, so UI work is checked in the browser. See docs/development.md.
- `pnpm dev:mobile`: the iPhone app in the simulator, with Metro (`--build` the first time and
  after native changes; `--fake` on the made-up mailbox).
- `pnpm dev:fake`: the web app on a made-up mailbox (a pretend Gmail, no Google or Otter
  account, no relay). Build and test against it rather than the user's real accounts; see the
  `test-otter-mail` skill (`.agents/skills`).
- `pnpm dev:demo` and `pnpm dev:demo:desktop`: `pnpm dev` and `pnpm dev:desktop` opening on the
  demo mailboxes, already added: the dedicated `otterware.demo@gmail.com` Google account and the
  local IMAP server's (`pnpm dev:mail`, started for you). For real Gmail, Google OAuth, Contacts,
  Calendar or IMAP checks. They come from `OTTER_MAIL_DEMO_MAILBOXES` in the main checkout's
  ignored `.env.local` (shared with T3 worktrees by symlink); `--login` signs them in to Google
  once per machine. Preserve the demo fixtures and send test mail only to the demo account itself.
  Keep credentials out of logs, commits, screenshots and app bundles. See
  [Demo mailboxes](docs/development.md#demo-mailboxes).
- `pnpm start` runs the built app unpackaged; `pnpm dist:desktop:dmg` builds a DMG in `release/`
  (on a Mac), `pnpm dist:desktop:deb` a .deb (on Linux).
- Data homes (`apps/desktop/src/paths.ts`, as in T3 Code): the installed app uses
  `~/.otter-mail/userdata`; dev runs use `~/.otter-mail/dev`, or `<worktree>/.otter-mail` in a
  linked worktree. `pnpm dev:desktop --home <dir>` overrides. Never point dev at the installed app's home.
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
  `otter-mail-site-nightly` Worker; a stable release, after its GitHub Release, to mail.otterware.app. Both answer at
  mail.otterware.app (one browser cache and sign-in): Settings → General's channel sets a
  cookie the stable Worker routes on (`site/src/worker.ts`); open tabs offer "Reload to update".
- iPhone: run the Release iPhone workflow from `main` when `apps/mobile` (or the core, packages
  and extensions it bundles) has changed. It builds the Expo app's production variant, uploads it
  to TestFlight, tags `ios-vX.Y.Z` and bumps `apps/mobile/package.json`.

`docs/runbook.md` is the short version of shipping each part; details in `docs/release.md`.

## Verifying

Before handing work back, run and fix:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm fmt`

For UI or behavior changes, run the app and check the change in it, at a 1600x1000 viewport.
For the iPhone app, run it (`pnpm dev:mobile`, or `pnpm ios:release` in `apps/mobile` as its
README shows) and check the change in the simulator, in light and dark.

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
