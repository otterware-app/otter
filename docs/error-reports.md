# Error reports

When something fails for someone, Sentry says what broke, where and for whom: the desktop app
(main, backend and window), the web app (page and backend worker), the relay, the site Worker
and both iPhone apps. Sentry's tracing says what's slow. Cloudflare's own logs (the relay's
`observability`) keep every relay request and the push pipeline's events; Sentry is where to
look first.

## What's sent, and what never is

Everything goes through `packages/shared/src/error-reports.ts`:

- **Who**: the Otter account (`user.id`, `email`, `username`) when signed in, else the
  install's report id (core's `services/error-reports.ts`, followed through
  `errorReports:changed`); the report id is also in the `install` context. The relay sets the
  user of each signed-in request. Search Sentry for `user.email:<address>`; Send feedback
  includes the report id (`install.reportId:<id>`).
- **Errors**: a `logger.error` line (with its Error and stack), a handler that failed
  (core's `callHandler`), what threw and nothing caught, React's error boundaries, a
  Durable Object's request or alarm, an agent's failed turn or check (tags `agent`, `phase`),
  a mailbox that hasn't synced for 6 hours of failing awake time (`sync-health`). The same
  message is sent at most once every ten minutes per process. Desktop adds native crash dumps
  and a screenshot; the iPhone apps a screenshot and the view hierarchy.
- **Breadcrumbs**, attached to the next error: our own `info`/`warn` log lines, routes,
  clicks, and the requests made.
- **Traces** (`TRACES_SAMPLE_RATE`, every one for now): page loads and route changes, the
  desktop and iPhone apps' launches, handlers (`ipc.handler`, a tenth of them), mail and
  calendar sync (`mail.sync`, `calendar.sync`), agent turns and scheduled runs
  (`agent.turn`, `agent.scheduled`), and in the relay its requests, watch renewals
  (`watch.renew`) and push fan-out (`push.fanout`). Add one with `measure(name, op, work)`.
- **Never**: secrets. Tokens become `[token]`, `Bearer`/`Basic` credentials and long opaque
  strings `[redacted]`, query strings (codes, searches) are cut, and requests' headers,
  cookies and bodies, the console and local variables are left out.
- **Tags**: `scope`, and for a handler that failed on a mailbox, `provider` (`gmail`, `imap`,
  `outlook`) and for IMAP `server` (a known provider's host or `other`). The channel is the
  `environment` (`stable`, `nightly`). Pass them as `logger.failure(scope, message, err, tags)`.

Settings → General → Support → **Send error reports** (on by default, per device) turns them
off; reports from before the app knows the choice are held, then sent or dropped.

## Logging so it's reported

- `logger.error(scope, message, err)`: someone should look at this. Pass the Error itself.
- `logger.failure(scope, message, err)`: something failed; a warning when it's the network's
  doing (offline, timed out, rate limited) or a mailbox is signed out, else an error.
- `logger.warn` / `logger.info`: context, sent only as breadcrumbs.

Give each reason a guard refuses its own message (one `throw` per reason, not `!a || b`):
Sentry groups errors by where they're thrown, and the message is what an issue says happened.

Mail sync logs what the user can see and fix (signed out, offline, rate limited) as a warning.
A relay 5xx is a warning on the devices too: the relay reports it once itself.

## Where it's wired

| Part    | Sends from                                                                        | Code                                                            |
| ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Desktop | main, for every process (Sentry's Electron IPC)                                   | `apps/desktop/src/error-reports.ts`, `backend.ts`, `preload.ts` |
| Web     | the page; the worker hands it its lines                                           | `apps/web/src/main/error-reports.ts`, `src/web/backend.ts`      |
| Relay   | the Worker and its Durable Objects                                                | `infra/relay/src/error-reports.ts`                              |
| iPhone  | the app (crashes as stack traces, hangs from iOS's MetricKit; Settings › Support) | `apps/ios/OtterMail/Reports/` (the same rules, in Swift)        |
| Agents  | Otter Agents for iPhone, core's lines through `reportLog`                         | `apps/agents-mobile/src/error-reports.ts`, `packages/mobile`    |
| Site    | the site Worker                                                                   | `site/src/worker.ts`                                            |

The relay logs its push pipeline as one JSON line per event (`infra/relay/src/log.ts`):
`push.received`, `push.fanout`, `mail.arrived`, `mail.check_failed`, `watch.renewed`,
`watch.failed`, `apns.sent`, `apns.failed`. Query them in Workers Logs. The relay smoke test
opens a "Relay smoke test failing" issue when a scheduled run fails and closes it once one
passes.

A build reports when its app has a DSN (`SENTRY_DSN` in `error-reports.ts`) and it's a
release; `OTTER_ERROR_REPORTS=1` lets a development build (`pnpm dev:fake`,
`pnpm dev:desktop`) report too. A local relay never does.

## Setup

1. Sentry projects: `otter-mail-desktop` (Electron), `otter-mail-web` (React),
   `otter-mail-relay` (Cloudflare), `otter-site` (Cloudflare), `otter-mail-ios` (Cocoa),
   `otter-agents-ios` (React Native). Paste their DSNs into `SENTRY_DSN`. They're public: they
   ship in the apps.
2. Source maps, so stacks show our TypeScript: an auth token (scope `project:releases`) as
   `SENTRY_AUTH_TOKEN`, and the org slug as `SENTRY_ORG`:
   - GitHub: secret `SENTRY_AUTH_TOKEN`, variable `SENTRY_ORG` (the Release workflow).
   - The web app's deploy (`site/scripts/build.ts`, in the Release workflow) uses the same two;
     `scripts/upload-sourcemaps.ts` skips the upload without them.
   - The iPhone's dSYMs (`otter-mail-ios`): the Release workflow's iPhone job uploads them with the
     same secret and variable (`scripts/release-ios.ts`).
3. In each project's settings: keep the server-side data scrubber on for secrets, as a second
   net.
4. Alerts: the default "new issue" alert is enough to start.
5. Resolving with fixes: Sentry's GitHub integration (Settings › Integrations) with this
   repository added. The Release workflow's `sentry_release` job then creates each version's
   release (`otter-mail@<version>`, in `otter-mail-desktop` and `otter-mail-web`) with its
   commits and a deploy to `stable` or `nightly`. A commit or PR that says
   `Fixes <SHORT-ID>` (the issue's ID, e.g. `OTTER-MAIL-DESKTOP-1A`, not the number in its URL)
   links to the issue, and the issue resolves when a release holding that commit is made; an
   event from a later version reopens it as a regression.

   Sentry resolves an issue only through a release in the issue's own project, so the iPhone has
   its own: the last step of the Release workflow's iPhone job (`scripts/sentry-release-ios.ts`)
   runs once App Store Connect has the build, and creates `otter-mail-ios@<version>+<build>` in
   `otter-mail-ios`, the exact name the app reports (`ErrorReports.swift`). It attaches every
   commit from the previous `ios-vX.Y.Z` tag to the released commit, then finalizes the release.
   An iPhone fix says `Fixes OTTER-MAIL-IOS-<n>` and resolves with the next iPhone release. If
   the step fails, the build and tag still go out: make the release by hand, as below.

   iPhone releases before this step (up to `ios-v0.8.5`) have no commits in Sentry, so fixes they
   shipped (OTTER-MAIL-IOS-2, in 0.8.5) stay open. To reconcile one, by hand and on purpose:
   `node scripts/sentry-release-ios.ts --version 0.8.5 --build 202611042249 --ref ios-v0.8.5`
   with `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` set. The build is in that run's log ("Uploaded
   0.8.5 (…)") and in TestFlight; a name that differs from what devices report makes a release
   no event belongs to. Or resolve the issue in Sentry's UI.
