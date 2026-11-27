# Otter Mail for iPhone

The Expo app uses the same mail store, sync and query hooks as the Mac and web apps. Its fake
mailboxes cover folders, scrolling and pagination, conversations, search, composing and
replying. What is still unverified on a phone is in the
[migration plan](../../docs/expo-migration.md#where-we-are).

```sh
pnpm dev:mobile:mail:fake
```

Development and TestFlight builds also offer the same made-up mail on the welcome screen, as
**Try the demo mailbox** (`@otter/mobile/demo`): a flag read before core starts, which opens
core's fake in its own home and Keychain service and reloads the app. Settings → Account →
**Sign in with Google** leaves it. The demo never sends error reports.

The app runs under `dev.otterware.mail.dev`, with Metro on port 8099. Expo prebuild generates
`ios/` from `app.config.ts`.

## Benchmark

```sh
pnpm bench:mobile:mail
```

It builds a simulator Release with `EXPO_PUBLIC_OTTER_DATA=fake EXPO_PUBLIC_OTTER_MAIL_BENCHMARK=auto`
(prebuilding first when `ios/` is missing, or with `--prebuild`), reinstalls it on the "Otter
Mail Benchmark" simulator (an iPhone 18 Pro, created and booted when needed; `--device <name or
UDID>` picks another, whose copy of the app loses its data) and launches it over a 50,000-message
fake Gmail mailbox. The app scrolls its list on its own through the first sync, then stages 200
fake Gmail changes and keeps scrolling through their replay, and writes what it measured to
`Documents/fake-mail-benchmark/benchmark-result.json`. The script prints it:

```text
                         longest      p95       CPU
First sync                856 ms     9 ms     30 ms   FAIL
  while rows showed       856 ms     9 ms     30 ms
Replay, 200 changes       548 ms    23 ms     39 ms   FAIL

First row: 5,728 ms after launch (informational)
First sync's longest block: 201,620 ms after launch
Slowest SQLite call, first sync: write INSERT INTO messages (accountId, id, threadId, f, 94 ms
Slowest SQLite call, replay: none ≥ 16 ms · replay took 1,532 ms
Gate: FAIL
```

Each figure is how late a 10 ms timer on the JavaScript thread came (`@otter/mobile/long-tasks`):
"longest" the longest block, "p95" the 95th percentile, "CPU" the thread's CPU time during the
longest block (near it: the thread worked; far below: it waited, on SQLite or a lock). First
sync counts from launch until it finishes; the replay from its start until it's applied. The
gate is both of them, while scrolling: longest block ≤ 50 ms and p95 ≤ 16 ms. The first row's
time and the rows-visible line are informational. A run takes about five minutes after the
build (whose output goes to `ios/build/benchmark-build.log`); `--skip-build` reruns the last
build, and `--timeout <minutes>` (20) is how long it waits for the results.

To scroll yourself, set `EXPO_PUBLIC_OTTER_MAIL_BENCHMARK=1` instead (with
`EXPO_PUBLIC_OTTER_DATA=fake`), in Metro's environment for a development build or in the
Release bundle's for measurements: scroll during first sync, then tap **Replay 200 changes**
and keep scrolling. The results show above the list. The benchmark gets separate local data
and runs the large fake inbox at the same pace as the Node benchmark
(`packages/core/bench/mail-sync.test.ts`).

## Production accounts

The config plugins generate the Google and Microsoft callback schemes and give both targets
the `group.<bundle identifier>.notifications` App Group. The app and notification service
compile the Swift credential readers from `packages/mobile/ios/MailShared` and use the same
Keychain group and locks.

The production bundle reads the Swift install's mailbox metadata and Otter session before core
starts, then resumes Gmail, Outlook and IMAP from the existing shared Keychain. Core rebuilds its
mail cache from the providers. The fake uses separate data and bypasses the native Mail host.

The upgrade also opens Swift's on-device draft recovery copies. The composer keeps edits on
this iPhone until you choose **Save to Drafts** or send, and unsent drafts can be reopened
from Drafts.

To regenerate the notices for Settings → Open-source licenses, run `pnpm licenses:mobile:mail`.

## Error reports

Release builds report to Sentry (`otter-mail-ios`, `SENTRY_DSN.mail` in
`packages/shared/src/error-reports.ts`) as the desktop and web apps do (docs/error-reports.md):
crashes, what core logs as an error, traces and what was touched (never a screenshot or the view
hierarchy: they show mail), from the Otter account (or the install's report id), while Settings →
Support → **Send error reports** is on; the Swift install's choice carries over. `src/error-reports.ts`
starts it before core; `EXPO_PUBLIC_OTTER_ERROR_REPORTS=1` makes a development build report
too. `metro.config.cjs` gives the bundle the SDK's `@sentry/core` for `@otter/shared` as well, so
core's reports reach its client. The release uploads the source maps and dSYMs and makes the
Sentry release (`otter-mail-ios@<version>+<build>`, `scripts/sentry-release-ios.ts`).

## Verified background notifications

Connect each mailbox in Settings → Mailboxes → the mailbox → Background notifications.
Gmail and Outlook use separate grants limited to notification metadata. IMAP requires
explicit consent to store its password for the relay's unread checks. Account and device
settings apply the more restrictive Inbox, All, or Off filter. The main app still reads
mail directly from the provider with its own credentials.

APNs carries a generic alert and the IDs for the verified arrival. The Swift notification
extension uses the App Group and shared credentials to fetch that message directly from
its provider. It adds sender, subject, and a preview locally. Locked devices can enrich
alerts after their first unlock since reboot. If the provider is unreachable or credentials
are locked or revoked, iOS can show the generic alert. Foreground taps route to the
mailbox and conversation. Local notifications still serve unconnected mailboxes.

### Apple setup and verification

The Expo config generates the app and its notification service with the existing Otter Mail
identities. The app uses `dev.otterware.mail` and its extension uses `dev.otterware.mail.notifications`.
Development adds `.dev` before the extension suffix. Enable Push Notifications and
Communication Notifications on the app and provision both targets for their matching App
Group. Keep the app-private Keychain group first. The generated APNs environment must match
the profile. See the [release guide](../../docs/release.md) for signing and the
[relay guide](../../infra/relay/README.md) for push credentials.

On a signed test iPhone, test Inbox, All, and Off. Include an arrival while locked after first
unlock, a revoked provider grant, and a notification tap for a conversation absent from
the cache. The simulator can exercise display and routing with a synthetic notification.
