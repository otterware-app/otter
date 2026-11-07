# Otter Mail mobile (Expo)

The iPhone app's successor to `apps/ios`: an Expo app (SDK 58, React Native 0.88) laid out like
Otter Code's `apps/mobile`, that runs the same TypeScript mail backend as the Mac and web apps,
`packages/core`, on the phone. Phase 0: core boots and syncs on the device, an inbox and a
thread render from it, and the gate below measures whether the architecture holds.

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
  - `otter-socket`: core's ByteStream, `apps/ios`'s MailSocket transports (NWConnection for TLS,
    URLSessionStreamTask for STARTTLS). The development variant trusts localhost certificates
    (`OtterTrustLocalMailServers`) for `pnpm dev:mail`.
  - `otter-net`: URLSession data tasks streamed through a delegate, and WebSockets.
  - `otter-credentials`: `apps/ios/NotificationShared`'s Keychain, Google and Microsoft
    credentials and PushState (linked, not copied): the one credential authority. Refresh tokens
    never reach JS.
  - `otter-translation` (Expo module): `native/translator` on iOS, NaturalLanguage detection and
    Apple's Translation for installed pairs, answering core's `detectLanguage` and `translate`.
  - `otter-background` (Expo module): the `dev.otterware.mail.refresh` BGAppRefresh task, handed
    to core's `background:refresh` (incremental sync of mailboxes synced before, within ~25s).
- **Notifications** (`src/features/notifications`, expo-notifications): the APNs token goes to
  core's `push:register` (`src/worker/push.ts`), which writes PushState for the extension and
  registers on the relay as `apps/ios` does; taps open their thread; core's `badge` and `notify`
  effects set the icon's count and post local notifications.
- **apps/ios's unsent messages** (its `draft-recovery/` copies) become drafts on first launch
  (`src/worker/recovered-drafts.ts`, `pnpm test`); the originals stay.
- **The notification service extension** is `apps/ios`'s, unchanged: a config plugin
  (`plugins/withNotificationServiceExtension.cjs`) copies its sources in at prebuild.
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
