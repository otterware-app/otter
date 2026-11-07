# Otter Mail mobile (Expo)

Otter Mail for iPhone: an Expo app (SDK 58, React Native 0.88) laid out like Otter Code's
`apps/mobile`, that runs the same TypeScript mail backend as the Mac and web apps,
`packages/core`, on the phone. Its production variant ships as `dev.otterware.mail`, the App
Store app the Swift app (`apps/ios`, removed after 0.8.8) was, so installs upgrade in place;
releasing it is in `docs/release.md`.

## How it works

- **Two runtimes.** The UI runs on React Native's runtime; core runs on its own Hermes runtime,
  a [react-native-worklets](https://docs.swmansion.com/react-native-worklets) worker runtime in
  **Bundle Mode** (`createWorkletRuntime` with its event loop): the worker evaluates the same
  bundle, so core's modules run there as ordinary code (`babel.config.js`, `metro.config.js`).
  Bundle Mode skips React Native's `InitializeCore` there and blocks TurboModules, so:
  - `src/worker/polyfills.ts` gives the worker what core expects of a browser: URL, crypto
    (`@noble/hashes` behind `crypto.subtle.digest`), streams, `structuredClone`, a
    `TextDecoder` that reads every legacy mail charset through the OS (`src/worker/text.ts`),
    and fetch and WebSocket over URLSession (`src/worker/net.ts`: streaming `Response.body`,
    WebSocket request headers).
  - Every native call core makes is a Nitro HybridObject. `otter-worker`'s C++
    `installNitro(runtime)` (called from the UI runtime) installs Nitro on the worker with a
    Dispatcher that schedules on it (`WorkletRuntime::schedule`), so Nitro's Promises and
    callbacks settle on the worker's thread.
- **The host.** `src/worker/host.ts` is `apps/web/src/web/worker.ts` for the phone: it starts
  core with the phone's Platform (`src/persistence/platform.ts`) and answers the UI's invokes
  through `callHandler`. The UI reaches it only through `CoreHost` (`src/state/core.ts`), an
  Effect service; `core-transport.ts` underneath (worklets' scheduling) is the piece the Effect
  RPC client replaces. Atoms in `src/state/mail.ts` (effect/reactivity) feed the screens.
- **Native modules** (`modules/`, Nitro, generated with `pnpm nitrogen`):
  - `otter-worker`: Nitro on the worker; randomness, legacy charsets (CoreFoundation),
    Application Support files, os_log, memory and uptime.
  - `otter-sqlite`: synchronous SQLite (the `sqlite3` pod with FTS5, WAL); `get`/`all`/`run`
    are raw JSI methods with a statement cache.
  - `otter-socket`: core's ByteStream, the Swift app's MailSocket transports (NWConnection for TLS,
    URLSessionStreamTask for STARTTLS). The development variant trusts localhost certificates
    (`OtterTrustLocalMailServers`) for `pnpm dev:mail`.
  - `otter-net`: URLSession data tasks streamed through a delegate, and WebSockets.
  - `otter-credentials`: `native/NotificationShared`'s Keychain, Google and Microsoft
    credentials and PushState (linked, not copied): the one credential authority. Refresh tokens
    never reach JS.
  - `otter-translation` (Expo module): `native/translator` on iOS, NaturalLanguage detection and
    Apple's Translation for installed pairs, answering core's `detectLanguage` and `translate`.
  - `otter-app` (Expo module): Inter as the text's default (React Native's font resolver), the
    app's version and build, and removing the Swift app's caches at launch.
  - `otter-background` (Expo module): the `dev.otterware.mail.refresh` BGAppRefresh task, handed
    to core's `background:refresh` (incremental sync of mailboxes synced before, within ~25s).
- **Notifications** (`src/features/notifications`, expo-notifications): the APNs token goes to
  core's `push:register` (`src/worker/push.ts`), which writes PushState for the extension and
  registers on the relay as the Swift app did; taps open their thread; core's `badge` and `notify`
  effects set the icon's count and post local notifications.
- **The Swift app's unsent messages** (its `draft-recovery/` copies) become drafts on first launch
  (`src/worker/recovered-drafts.ts`, `pnpm test`); the originals stay.
- **The notification service extension** is Swift, in `native/` (the Swift app's, unchanged): a
  config plugin (`plugins/withNotificationServiceExtension.cjs`) copies its sources in at
  prebuild and adds its target. Its tests (labels and modes, routing, previews,
  the completion race, IMAP parts, connection loss) run on the Mac with
  `swift test --package-path apps/mobile/native` (`native/Package.swift`).
- **Error reports** go to Sentry's `otter-mail-ios` (`src/error-reports.ts`,
  docs/error-reports.md).
- **Variants** (`APP_VARIANT`): development (`dev.otterware.mail.dev`), preview
  (`dev.otterware.mail.preview`) and production (`dev.otterware.mail`), each with its own Keychain
  access group and App Group (`group.<bundle id>.notifications`), so development and preview
  builds never read production's sign-ins.

## Developing

A Debug build loads both runtimes from Metro, so JS changes need no native build:

```bash
pnpm dev:mobile --fake          # from the repo root: Metro, on the made-up mailbox
pnpm dev:mobile --build --fake  # the first time, and after native changes: prebuild, build, install
```

`--relay local` points core at `pnpm dev`'s relay; `--port` and `--device <udid>` pick Metro's
port and the simulator. The switches are `EXPO_PUBLIC_*` variables Metro inlines (a Debug build's
`expoConfig` is the one it was built with), so changing them only takes restarting Metro.

- **UI code** (`src/features`, `src/state`, client-runtime) Fast Refreshes in place.
- **What runs on the worker** (`src/worker`, `src/persistence`, `packages/core`, its extensions)
  reloads the app instead: the worker evaluates the bundle the app downloaded at launch, so
  `core-transport.ts` accepts those updates by reloading, which starts the worker on the new
  bundle (`[Worklets] … Downloaded the bundle` in Metro's log).
- Logs from both runtimes show in Metro's terminal; core's are `[gmail:…]`, `[core:…]`.
- Native code (`modules/`, `plugins/`, `app.config.ts`, dependencies) needs `--build`.

`metro.config.js` hashes the worklets' generated files (`react-native-worklets/.worklets/`) from
disk when Metro's file map hasn't seen them yet: Bundle Mode's Babel plugin writes them while
Metro transforms, which otherwise fails the first bundle (Debug, or a one-shot Release bundle on
a fresh checkout) with "Failed to get the SHA-1".

## Running it

From `apps/mobile`, with a simulator booted:

```bash
pnpm ios:release         # prebuild, a Release build in the simulator
pnpm ios:dev             # a Debug build with Metro
```

Gmail, Outlook and IMAP sign in on the phone. `OTTER_MAIL_FAKE_MAILBOX=1` builds on the made-up
mailbox (`apps/web`'s fake Gmail) instead, and `OTTER_MAIL_RELAY_URL=http://localhost:8787` on
`pnpm dev`'s relay.

Core keeps a window of recent mail (`KEEP_RECENT`: 90 days and at least 400 conversations,
bodies as they're opened) and syncs fully only while the app is in front: the UI keeps whether
it is in a worklets Synchronizable the worker's `inForeground` reads, and coming back calls
`core.resume`.

## The gate

`Inbox → Gate` (or `ottermail-dev://gate?run=all&n=1`) runs each probe on the worker and logs it
as `[gate] …` (subsystem `dev.otterware.mail`): `run=all`, `scroll` (5,000 threads while the
worker writes), `net` / `net-status` (with `pnpm gate:server` on the Mac), or a probe's name:
`translate`, `notify`, `background`, `recovered-drafts`, and `dev-session` (an Otter account from
a `DEV_DEMO` relay, e.g. `OTTER_MAIL_RELAY_URL=http://localhost:8787`, to check push
registration without Google).

On the simulator, `xcrun simctl push` never runs the notification service extension, BGTaskScheduler
refuses to schedule (so `_simulateLaunchForTaskWithIdentifier:` finds no request), and Translation
reports every pair unsupported: those three need a device.

## Verified background notifications

Gmail, Outlook and IMAP use one APNs pipeline. Background alerts are an explicit, per-mailbox
connection to the Otter account (Settings → Mailboxes → the mailbox → Background notifications).
New Gmail and Outlook mailbox setup offers the additional limited provider consent as part of
setup. IMAP asks explicitly before storing its password with Otter. The existing device sign-in
continues to read mail directly; connecting notifications does not replace it or transfer full
Gmail/Microsoft grants between devices. A server connection is shared by the account's devices.

The relay verifies a new message and its current unread/folder state **before** submitting an
alert, and rechecks just before APNs. Read/archive/label changes, watch renewal, initial sync and
an unconnected mailbox do not create alerts. Inbox admits unread inbox arrivals; All also admits
unread arrivals elsewhere, excluding sent, drafts, junk and trash. Account/device settings use the
more restrictive filter. Off stops future submissions once the relay receives the change.

APNs carries only a generic “New mail. Open Otter Mail to read it.” alert, normal sound, and
allowlisted user/mailbox/provider/message identifiers. It carries no sender, subject, preview,
message body, attachment, provider credential or unread badge. The embedded
`OtterMailNotificationService` (`native/NotificationService`) fetches the indicated message **directly from Gmail, Microsoft
Graph or the IMAP server**, then adds sender, subject and a bounded preview locally. The phone
never walks mailbox history to guess what arrived; any other payload keeps the generic text.

The generic fallback now corresponds to a verified arrival. It remains if the phone is offline,
Google/Microsoft access was revoked, the IMAP UIDVALIDITY changed, credentials are locked, or the
22-second deadline expires. Ordinary extensions cannot suppress an accepted alert: mail read on
another device after submission can still appear, and APNs/extension execution are best effort.
No restricted Apple filtering entitlement is required. Foreground generic alerts are suppressed
by the supported presentation delegate. Local alerts are disabled only for mailboxes connected
to this push pipeline, so a second background/local alert isn't generated for the same arrival.
Unconnected mailboxes keep local notification behavior.

Gmail's server grant is limited to `gmail.metadata`; the reader requests only message IDs,
labels and history. This permission can also read headers, but the notification service does not
request sender/subject headers or content. Google's actual granted scopes are checked at exchange
and on every refresh; broader grants are rejected. The existing Google web client/registered
callback can issue this separate limited grant. Outlook uses a separate Microsoft app registration
with `User.Read`, `Mail.ReadBasic` and `offline_access`; it cannot share the full-mail application's
refresh-token authority. IMAP credentials normally authorize mailbox content even though the
watcher reads UIDs, flags, INTERNALDATE and Message-ID (stored only as a deduplication hash).
Server credentials are encrypted at rest under a dedicated Worker secret. No server mail cache,
body download or notification-enrichment proxy is added. Disconnecting notifications deletes the
grant and stops its watcher; unlink/account deletion cascades deletion. Revoked/expired Otter
sessions lose device routing; a watcher pauses when no enabled authorized devices remain.

The server renews Gmail watches and Outlook subscriptions, so renewal no longer depends on
opening the phone within seven days. A five-minute reconciliation also catches dropped provider
events. IMAP uses bounded IDLE cycles for the inbox; other eligible folders are scanned in rotating
batches. UIDVALIDITY rebases never announce old mail. Message-ID hashes and arrival dates prevent
ordinary copies/moves from becoming new-mail alerts. Alerts coalesce in five-second bursts, with
at least 30 seconds between submissions per mailbox and bounded transient-error retries.
Subscriptions, grants and device sessions can still expire or be revoked; reconnect when Settings
says authorization is required. Opening the app always syncs directly from the provider.

`native/NotificationShared/` contains the direct readers, coordinated OAuth refresh, shared Keychain and
App Group configuration. Provider secrets and access tokens live in the App Group's Keychain
group and use `AfterFirstUnlockThisDeviceOnly`: enrichment can work on a locked phone **after the
first unlock since reboot**, and falls back before that. Otter session credentials stay private to
the app. Cross-process locks serialize refresh; removal/replacement checks prevent an in-flight
refresh from restoring deleted credentials. Debug/release storage, topics and tokens are separate.

Enriched Gmail/Outlook taps open the mailbox/conversation, fetching it directly if absent from the
cache. IMAP taps resolve the notified UID into its local thread, loading the folder if needed.
Generic taps open the mailbox and sync. Notification previews render Markdown as plain text and
keep link labels. The made-up mailbox needs no Google, Microsoft, IMAP, Apple or Otter
credentials.

### Apple setup and verification

Register App IDs for `dev.otterware.mail.dev` / `dev.otterware.mail.preview` /
`dev.otterware.mail` and their `.notifications` extensions. Enable Push Notifications on the **app**, and App Groups/Keychain Sharing on both
app and extension. Provision both targets for their matching group:
`group.<bundle id>.notifications` (development, preview and production each have their own).
The app-private Keychain group stays first: it's the default group, where the Otter session is
kept. `app.config.ts` gives each variant its `APNsEnvironment` and signed `aps-environment`, which
must match: development → sandbox; preview and production (TestFlight) → production. If signing with a
custom development profile, keep the plist environment consistent with that profile.

The shared App Group also grants Keychain access under its unprefixed group name. Keep only the
app-private prefixed group in `keychain-access-groups`; adding the App Group there fails signed
archives against the profiles' prefixed Keychain allowlist. Google token queries select the App
Group explicitly, while Otter sessions stay in the app-private default group.

Regenerate the main App Store profile with the new capabilities, and add the extension's
“Otter Mail Notifications App Store” profile. The release workflow also needs
`IOS_NOTIFICATION_PROVISIONING_PROFILE` (base64); see `docs/release.md`. Configure the relay's
APNs signing key and allowed topics as described in `infra/relay/README.md`. The APNs key is
separate from the App Store Connect upload key; never put either in this checkout.

Build the production variant (`pnpm release:ios --unsigned` from the repository root) and the
development one (`pnpm ios:release`), and check the made-up mailbox in light and dark.
For a signed-in test account, permit notifications and test Inbox/All/Off, locked-device
arrival, multiple mailboxes, a generic tap and a thread absent from the local cache.

A simulator payload can exercise display/tap wiring:

```json
{
  "aps": {
    "alert": {
      "title": "Otter Mail",
      "body": "New mail. Open Otter Mail to read it."
    },
    "mutable-content": 1
  },
  "otter": {
    "version": 2,
    "userId": "<test-account-id>",
    "email": "<test-mailbox>",
    "provider": "gmail",
    "historyId": "<sequence>",
    "messageId": "<gmail-message-id>",
    "mode": "inbox"
  }
}
```

Save it outside the repository and run `xcrun simctl push booted dev.otterware.mail.dev <payload>`.
Payload injection does **not** prove live APNs, or that the service extension ran/fetched Gmail
on that simulator. Verify live sandbox delivery on a provisioned iPhone and production delivery
in TestFlight. Use a test Gmail, with a baseline established by opening/syncing before sending
new mail. Validate timeout/offline fallback, token rotation, remote revocation/unlink and the
first unlock after reboot. CI's iPhone job builds the app and extension on the Xcode 27 runner,
runs the mobile tests, captures the made-up mailbox in light/dark and archives the production
variant unsigned. Linux development cannot run these
checks locally. Live APNs, extension Gmail access and signed-in notification/tap/preference
checks still require a provisioned iPhone; CI's screenshots do not cover them.

Sources: [Apple extension requirements](https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications),
[Apple filtering entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.filtering),
[Keychain sharing](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps),
[Gmail push/watch renewal](https://developers.google.com/workspace/gmail/api/guides/push),
[Gmail history](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list).
