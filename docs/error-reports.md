# Error reports

When something fails for someone, Sentry says what broke and where: the desktop app (main,
backend and window), the web app (page and backend worker) and the relay. Cloudflare's own
logs (the relay's `observability`) still keep every relay request; Sentry is where to look first.

## What's sent, and what never is

Everything goes through `packages/shared/src/error-reports.ts`:

- **Errors**: a `logger.error` line (with its Error and stack), a handler that failed
  (core's `callHandler`), what threw and nothing caught, React's error boundaries, a
  Durable Object's request or alarm. The same message is sent at most once every ten minutes
  per process.
- **Breadcrumbs**, attached to the next error: our own `info`/`warn` log lines (scope and
  message, never their data), routes, and the requests made (address only, no query string).
- **Never**: session replays, screenshots, native crash dumps (they hold memory), local
  variables, cookies, headers, request bodies, IP addresses or the location Sentry would read
  from them, the console, what was clicked, the pages the browser's tabs show.
  Every string is scrubbed: addresses become `[email]` (and a mailbox's route after it),
  tokens `[token]`, home folders `/Users/[user]`, query strings are cut, long opaque
  strings `[redacted]`.
- **Tags**: `scope`, and for a handler that failed on a mailbox, what kind it is:
  `provider` (`gmail`, `imap`, `outlook`) and, for IMAP, `server`, the IMAP host when it's one
  of discovery's known providers (`imap.mail.me.com`, `imap.fastmail.com`, …) and `other` for
  anything else, since a custom domain's host could say who. The channel is the
  `environment` (`stable`, `nightly`). Pass them as `logger.failure(scope, message, err, tags)`.
- **Identity**: only a random report id per install (core's `services/error-reports.ts`).
  Send feedback includes it, so an issue can be matched to its errors: search Sentry for
  `user.id:<id>`.

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

## Where it's wired

| Part    | Sends from                                                                                                                 | Code                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Desktop | main, for every process (Sentry's Electron IPC)                                                                            | `apps/desktop/src/error-reports.ts`, `backend.ts`, `preload.ts` |
| Web     | the page; the worker hands it its lines                                                                                    | `apps/web/src/main/error-reports.ts`, `src/web/backend.ts`      |
| Relay   | the Worker and its Durable Objects                                                                                         | `infra/relay/src/error-reports.ts`                              |
| iPhone  | the app, core on its worker runtime (its `report` effects), native crashes, hangs from iOS's MetricKit; Settings › Support | `apps/mobile/src/error-reports.ts` (`@sentry/react-native`)     |

A build reports when its app has a DSN (`SENTRY_DSN` in `error-reports.ts`) and it's a
release; `OTTER_MAIL_ERROR_REPORTS=1` lets a development build (`pnpm dev:fake`,
`pnpm dev:desktop`) report too (on the iPhone, `EXPO_PUBLIC_OTTER_MAIL_ERROR_REPORTS=1` for a
Debug build). The iPhone keeps the choice and the report ID in UserDefaults
(`otter:errorReports`, `otter:reportID`), where the Swift app kept them; turned off, Sentry
doesn't start at the next launch, so native crashes aren't sent either. A local relay never does.

## Setup

1. Sentry projects: `otter-mail-desktop` (Electron), `otter-mail-web` (React),
   `otter-mail-relay` (Cloudflare). Paste their DSNs into `SENTRY_DSN`. They're public: they
   ship in the apps.
2. Source maps, so stacks show our TypeScript: an auth token (scope `project:releases`) as
   `SENTRY_AUTH_TOKEN`, and the org slug as `SENTRY_ORG`:
   - GitHub: secret `SENTRY_AUTH_TOKEN`, variable `SENTRY_ORG` (the Release workflow).
   - The web app's deploy (`site/scripts/build.ts`, in the Release workflow) uses the same two;
     `scripts/upload-sourcemaps.ts` skips the upload without them.
   - The iPhone's dSYMs and Hermes source map (`otter-mail-ios`, under the release and dist the
     app reports): the Release iPhone workflow uploads them with the same secret and variable
     (`scripts/release-ios.ts`).
3. In each project's settings: turn off "Store client IP addresses" and keep the server-side
   data scrubber on, as a second net.
4. Alerts: the default "new issue" alert is enough to start.
5. Resolving with fixes: Sentry's GitHub integration (Settings › Integrations) with this
   repository added. The Release workflow's `sentry_release` job then creates each version's
   release (`otter-mail@<version>`, in `otter-mail-desktop` and `otter-mail-web`) with its
   commits and a deploy to `stable` or `nightly`. A commit or PR that says
   `Fixes <SHORT-ID>` (the issue's ID, e.g. `OTTER-MAIL-DESKTOP-1A`, not the number in its URL)
   links to the issue, and the issue resolves when a release holding that commit is made; an
   event from a later version reopens it as a regression.

   Sentry resolves an issue only through a release in the issue's own project, so the iPhone has
   its own: the Release iPhone workflow's `sentry_release` job (`scripts/sentry-release-ios.ts`)
   runs once App Store Connect has the build, and creates `otter-mail-ios@<version>+<build>` in
   `otter-mail-ios`, the exact name the app reports (`apps/mobile/src/error-reports.ts`, from the app's
   CFBundleShortVersionString and CFBundleVersion). It attaches every
   commit from the previous `ios-vX.Y.Z` tag to the released commit, then finalizes the release.
   An iPhone fix says `Fixes OTTER-MAIL-IOS-<n>` and resolves with the next iPhone release. If
   the job fails, the build and tag still go out: rerun the failed job.

   iPhone releases before this job (up to `ios-v0.8.5`) have no commits in Sentry, so fixes they
   shipped (OTTER-MAIL-IOS-2, in 0.8.5) stay open. To reconcile one, by hand and on purpose:
   `node scripts/sentry-release-ios.ts --version 0.8.5 --build 202611042249 --ref ios-v0.8.5`
   with `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` set. The build is in that run's log ("Uploaded
   0.8.5 (…)") and in TestFlight; a name that differs from what devices report makes a release
   no event belongs to. Or resolve the issue in Sentry's UI.
