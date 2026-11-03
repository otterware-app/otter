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

Mail sync logs what the user can see and fix (signed out, offline, rate limited) as a warning.

## Where it's wired

| Part    | Sends from                                            | Code                                                            |
| ------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Desktop | main, for every process (Sentry's Electron IPC)       | `apps/desktop/src/error-reports.ts`, `backend.ts`, `preload.ts` |
| Web     | the page; the worker hands it its lines               | `apps/web/src/main/error-reports.ts`, `src/web/backend.ts`      |
| Relay   | the Worker and its Durable Objects                    | `infra/relay/src/error-reports.ts`                              |
| iPhone  | the app (crashes as stack traces; Settings › Support) | `apps/ios/OtterMail/Reports/` (the same rules, in Swift)        |

A build reports when its app has a DSN (`SENTRY_DSN` in `error-reports.ts`) and it's a
release; `OTTER_MAIL_ERROR_REPORTS=1` lets a development build (`pnpm dev:fake`,
`pnpm dev:desktop`) report too. A local relay never does.

## Setup

1. Sentry projects: `otter-mail-desktop` (Electron), `otter-mail-web` (React),
   `otter-mail-relay` (Cloudflare). Paste their DSNs into `SENTRY_DSN`. They're public: they
   ship in the apps.
2. Source maps, so stacks show our TypeScript: an auth token (scope `project:releases`) as
   `SENTRY_AUTH_TOKEN`, and the org slug as `SENTRY_ORG`:
   - GitHub: secret `SENTRY_AUTH_TOKEN`, variable `SENTRY_ORG` (the Release workflow).
   - Cloudflare Workers Builds for `site/`: the same two as build variables.
     `scripts/upload-sourcemaps.ts` skips the upload without them.
   - The iPhone's dSYMs (`otter-mail-ios`): the Release iPhone workflow uploads them with the
     same secret and variable (`scripts/release-ios.ts`).
3. In each project's settings: turn off "Store client IP addresses" and keep the server-side
   data scrubber on, as a second net.
4. Alerts: the default "new issue" alert is enough to start.
