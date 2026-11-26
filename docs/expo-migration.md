# Moving the iPhone apps to Expo

Otter Mail and Otter Agents for iPhone are being rebuilt on Expo (React Native), so they run
the same TypeScript as the Mac, Linux and web apps instead of a Swift port of it. Checked
against the code and against Expo SDK 58 (October 2026: React Native 0.88, React 19.3, Hermes
V1, built for iOS 27). What is marked "verify" was not confirmed and belongs to a spike in
phase 0. iPhone only: there is no Android app, and nothing here is shaped for one.

## Where we are

The Expo Agents app uses the shared account and agent code for Chats, Scheduled and
Settings. Swift Google sign-in and picture processing live in `packages/mobile/ios`.
The Expo app exchanges Google's ID token for an Otter session through core. The cutover
uses the existing App Store bundle ID and builds the iOS project from the Expo app.

The combined Expo Debug and Release simulator builds include Talk, the live agent browser and
the notification service extension. The Release package includes an embedded JavaScript bundle
and passed simulator signature verification. Talk and the browser reuse the Swift engines.
Live audio, browser controls and notification delivery still need device checks.

On an iPhone 18 Pro simulator, Expo 0.2.0 opened fixture Chats after an in-place update
over Swift 0.1.29 under the shipping bundle ID. The attachment tray fitted its actions
in light and dark, and switching to the keyboard kept the draft. A signed iPhone update
still needs to verify the existing Keychain items and production notification permissions.

On the web, real Hermes and OpenClaw gateways completed turns. OpenClaw kept a single
reply when the app reloaded during a subagent wait, and an existing chat reconnected
after the gateway was removed and added again. On Expo, the real OpenClaw checks
covered token pairing, streaming, the work log, questions, Stop and resume after
relaunch. Setup-code pairing, the remaining queue and waiting flows, sessions,
files, scheduled runs and a real Hermes turn still need simulator verification.
Live varys verification needs a service.

The signed Expo Agents build launched on a physical iPhone, signed in to the Otter account,
and showed the existing OpenClaw gateway after the account sync. The phone starts that
HTTP sync at sign-in without waiting for the realtime connection. The shipping-ID build reads
the Swift app's account token, device ID and OpenClaw pairing from the existing install. It
replays pending changes with their original exchange IDs and downloads the current relay copy.
Check these on a signed upgrade. On a development install with its own identity, connect
from the existing gateway's settings to keep its chats.

The Otter Mail draft builds the Expo app and notification service under the existing App
Store identity. The production signing settings use the existing app and extension profiles.
The simulator comparison covers the Swift and Expo inbox, reader, and reply sheet in light
and dark. The Expo branch adds native Photos and Translation, on-device draft recovery,
and background notification setup. The upgrade seeds local Swift appearance, mailbox, notification,
and language preferences before starting sync.

Three iPhone 18 Pro simulator Release runs scrolled through the 50,000-message Gmail fixture.
The third ran with the bounded Inbox query, which returned the first page in under 1 ms in
a separate query test against the populated fake database. The 377 ms peak in that run
came about two minutes after launch, while rows were visible.

| Run | First row | First sync max / p95 | 200-change replay max / p95 |
| --- | --------: | -------------------- | --------------------------- |
| 1   |  4,094 ms | 186 ms / 14 ms       | 40 ms / 8 ms                |
| 2   |  7,585 ms | 311 ms / 10 ms       | 539 ms / 15 ms              |
| 3   |  5,724 ms | 377 ms / 10 ms       | 217 ms / 31 ms              |

A separate V8 profile on the same 50,000-message fixture measured 86.6 ms max and 12 ms p95
in first sync, and 41.8 ms max and 6.7 ms p95 in replay. The longest first-sync window
contained a SQLite message write. A second 71.5 ms window was mostly garbage collection.
The longer iOS peaks still need on-device profiling.

The in-place internal TestFlight update to 0.8.35 (202611242208) preserved the existing
mailboxes and drafts on an iPhone. Live push still needs a signed device check.

The fourth simulator run moved passive WAL checkpoints to a separate SQLite connection.
It reached its first row at 4,821 ms. First sync measured 599 ms max and 10 ms p95. The
longest SQLite call was a 37 ms read at a different time. The replay measured 63 ms max
and 18 ms p95.

The fifth run used the standalone Expo app with the old Swift target removed. First sync
reached the first row at 5,921 ms and peaked at 531 ms, with 9 ms p95. The JavaScript thread
used 30 ms of CPU during the longest timer delay and reached 76 ms of CPU in a separate
interval. A synchronous SQLite write took 119 ms. The 200-change replay peaked at 67 ms
with 42 ms p95. The 50 ms maximum remains open.

|                   | Otter Mail (`apps/ios`) | Otter Agents (`apps/ios-agents`, deleted) |
| ----------------- | ----------------------- | ----------------------------------------- |
| Swift, app        | about 13,500 lines      | about 18,000 lines                        |
| Swift, tests      | about 2,200             | about 3,000                               |
| Ports TypeScript  | about 8,500 lines       | about 8,000 lines                         |
| Swift packages    | Sentry                  | none                                      |
| Extension targets | notification service    | notification service                      |

About half of the Swift is a second implementation of code that already exists in TypeScript:

- Otter Mail's `Gmail/`, `Outlook/`, `Imap/`, `Mail/` and `Account/` are `packages/core`'s
  providers, protocols, sync, store, relay account and preferences, written again. Core keeps
  the whole mailbox in SQLite with full-text search; the phone keeps the newest 400 threads in
  JSON.
- Otter Agents' `Clients/` (OpenClaw, Hermes, varys), `Schedules.swift`, `AgentSync.swift`,
  `AgentEntries.swift` and `ChatStore.swift` are the extensions' `./core` halves, core's
  `agent-sync.ts`, contracts' `applyMutation` and `@otter/client`'s `chat-store.ts`, each with a
  "change both together" rule.
- `VerificationCode.swift`, `Scrubber.swift`, `ScheduleText.swift`, `ChatShelves.swift` and
  `MailContext.swift` are ports of files in `packages/shared` and `apps/web/src/main/agent`.

The iPhone column of `docs/features.md` is mostly a list of what the port hasn't caught up on:
invitations, sender photos, snooze, send later, undo send, label editing, views, themes.

Core was built for this. It has no `node:` imports, no DOM and no `Buffer`; everything that
differs by host goes through `Platform` (`packages/core/src/platform.ts`), and it already runs
in two hosts (an Electron utility process, a Web Worker). The renderer reaches it only through
`window.desktopBridge`. A phone is a third host.

## What gets shared, and what doesn't

Three layers are shared, one is not.

1. **Core, whole.** `packages/core`, `packages/contracts`, `packages/shared` and the
   extensions' `./core` halves run in the phone app behind a phone `Platform`. This is where
   most of the saving is: the Swift data layers are deleted, not ported again.
2. **The renderer's logic.** What `apps/web/src/main` holds that isn't JSX moves to a package
   both the web renderer and the phone apps import: the typed API clients (`mail/api.ts`), the
   TanStack Query hooks (`mail/hooks.ts`), the chat store, shelves, runs, schedule text, reply
   and forward maths, search-operator parsing, undo, label trees, synced preference keys.
   About 16,000 of the renderer's 62,000 lines; the rest is JSX.
3. **The design system's tokens and vocabulary.** The same tokens, type scale, radius scale and
   component names, drawn by React Native components.
4. **Not shared: the screens.** `@otter/ui` is Base UI and Tailwind on the DOM, and the web
   app has no narrow layout (no breakpoints, hover-first, a three-pane window). The phone's
   screens are written in React Native, to today's phone design. That is a rewrite of the
   SwiftUI screens in another language, and it is the bulk of the work.

## Target layout

```
apps/
  mail-mobile/       Otter Mail: Expo, routes, app config, targets/ (its notification service)
  agents-mobile/     Otter Agents: the same
packages/
  core/              + Platform kind "mobile"; which services start is an option
  client/            new: the renderer's logic, shared by apps/web and the phone apps
  ui/                tokens also emitted for React Native
  ui-native/         new: @otter/ui's components under the same names, on React Native
  mobile/            new: what both phone apps share: the Platform, the bridge, sign-in,
                     notifications, and the native module (Swift)
extensions/*         + a ./mobile half beside ./ui, for the ones a phone has
```

Two apps stay two apps ("the phone gets an app per job"), with their bundle ids, App Store
records, URL schemes and notification extensions as they are. They are thin: routes and
config. Names are proposals.

## The phone host

### Platform

| `Platform` member        | On the phone                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database()`             | `expo-sqlite`'s synchronous API (prepared statements, FTS5 on by default, JSON1), WAL                                                                |
| `files`                  | `expo-file-system`                                                                                                                                   |
| `secrets`                | the Keychain through our module (`packages/mobile/ios`), generic passwords under today's service and item names                                      |
| `userFiles`              | `expo-file-system`'s document picker and Quick Look, the share sheet (`expo-sharing`); photos are the screens' own picker                            |
| `google`, `microsoft`    | PKCE in an auth session (`expo-web-browser`, the same redirect schemes); tokens kept and refreshed by `NotificationShared`'s Swift, as today         |
| `connect()`              | `MailSocket.swift` (Network.framework, STARTTLS through `URLSessionStreamTask`) exposed as a `ByteStream`                                            |
| `relaySession`           | `"bearer"`                                                                                                                                           |
| `broadcast`              | the bridge's listeners                                                                                                                               |
| `notify`, badge          | `expo-notifications` (local alerts, badge, the APNs device token for the relay)                                                                      |
| `onResume`, `onPresence` | `AppState`                                                                                                                                           |
| `asyncContext`           | the no-op the web uses                                                                                                                               |
| `offlineDownloads`       | `false`, as the web                                                                                                                                  |
| `translator`             | Apple's Translation through the module (`native/translator`'s `TranslationSession(installedSource:target:)`), which brings the Translation extension |
| the demo                 | `@otter/core/fake` (`withFakeServices`, `withFakeAgents`), replacing `DemoMail.swift` and `Demo/DemoAgent.swift`                                     |

The renderer's contract is kept: the phone sets `window.desktopBridge` (`invoke` to
`callHandler`, `on` from `broadcast`, `features` with what a phone has), so the shared hooks
and stores run unchanged.

### Changes to core

Small, and each one is also right for the other hosts:

- `Platform.kind` gains `"mobile"` and `AppPlatform` gains `"ios"`. Today `"desktop"` turns on
  the Gmail-over-IMAP backfill and `"web"` picks the web sign-in return; the phone is neither.
- `startCore` takes which modules to start. Otter Agents has no mail, and today it starts mail
  sync, calendar sync and reminders unconditionally.
- `services/realtime.ts:171` passes the bearer header in Node's argument position; React
  Native's `WebSocket` takes it in a third argument.
- Relative imports ending in `.js` that name `.ts` files (123 files in core, 4 in contracts, 50
  in extensions) become `.ts`, which the base tsconfig already allows and 40 core files
  already use. Metro reads source as written; a resolver shim is the alternative.
- What only the phone does today moves in: registering the APNs device with the relay, the
  background-notification connections, writing the extension's configuration file.
- Phone-shaped sync: the phone mirrors what the web does (inbox first, bodies on open), not the
  desktop's whole-mailbox download, with a storage cap.

### What Hermes lacks

Checked on the simulator (iOS 27, React Native 0.88.1, Expo SDK 58) by the self-test
(`packages/mobile/src/self-test.ts`, at `/self-test` in Otter Agents' development builds), which
also runs core's fake end to end through the bridge; CI is to run it on the simulator.

| Needed                                                     | Used by                                                    | SDK 58                                                                               | What we do                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming `response.body`, streams                         | Hermes's event stream, chat files, Drive                   | built in (Expo's fetch is the global)                                                | nothing                                                                                                                                                       |
| `URL`, `structuredClone`, `atob`, `TextEncoder`            | throughout; the fake                                       | built in (Expo installs `URL` and `structuredClone`)                                 | nothing                                                                                                                                                       |
| `TextDecoder` for any charset                              | IMAP mail (`imap/structures.ts`, postal-mime)              | UTF-8, UTF-16, windows-1252; not Shift_JIS, GBK, EUC-KR, ISO-2022-JP                 | Foundation decodes the rest (Shift_JIS, GBK…) through the module, in phase 2                                                                                  |
| `crypto.randomUUID`, `getRandomValues`, `subtle` (SHA-256) | 12 places in core; Todoist's PKCE                          | missing: no `crypto` at all                                                          | `expo-crypto`, installed as `crypto` by `@otter/mobile/polyfills` before core loads                                                                           |
| `crypto.subtle` Ed25519                                    | OpenClaw's device key                                      | missing                                                                              | CryptoKit through our module (`packages/mobile/ios`), as the Swift app signs: `generateKey`, `exportKey`/`importKey` as JWK, `sign`                           |
| `AbortSignal.timeout`, `any`, `throwIfAborted`             | every Gmail and Graph request                              | built in (React Native's abort API)                                                  | nothing                                                                                                                                                       |
| `Blob` built from bytes                                    | postal-mime (every IMAP body part), varys's uploads        | refused: "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported" | postal-mime is patched to join bytes itself (`patches/postal-mime@4.0.0.patch`, to offer upstream); varys's uploads wait (the phone doesn't offer them today) |
| `EventTarget`, `Event`, `MessageEvent`                     | the fake relay's socket                                    | `EventTarget` and `Event` built in; no `MessageEvent`                                | the fake sends an `Event` with `data`, as its close event has a `code`                                                                                        |
| `Intl…formatToParts` with a time zone; `\p{…}`, lookbehind | calendar wall-clock; `verification-code.ts`, `chat-search` | built in (Hermes V1)                                                                 | nothing                                                                                                                                                       |
| SQLite: FTS5, JSON1, WAL                                   | the mail store's search; chats and agent sync              | built in (`expo-sqlite` ships its own SQLite)                                        | nothing                                                                                                                                                       |
| `Array#toSorted`                                           | `@otter/client`, the recents card                          | missing (`toReversed`, `toSpliced`, `with`, `findLast`, `at` are built in)           | `@otter/mobile/polyfills` installs it                                                                                                                         |

`react-native-quick-crypto` was the plan for Web Crypto; `expo-crypto` and CryptoKit cover what
core uses without OpenSSL, Nitro or a global `Buffer`. Core, contracts, shared and client are
typechecked a second time without the DOM library (`tsconfig.mobile.json` in each: ES2023 and a
Web Worker's globals), so a DOM call can't slip into what the phone runs.

### Threading

Core's SQLite interface is synchronous, and both existing hosts keep core off the UI's thread
"so syncing never holds up the app". React Native has one JavaScript thread by default. Native
scrolling, gestures on the UI thread and native transitions don't wait on it; list rows
rendering, taps and state updates do. A sync writing a few hundred rows in one transaction, or
parsing a 10 MB IMAP message, would show as blank rows while scrolling.

The decision is made reversible by keeping what the other hosts have: the UI talks to core only
through the bridge, in serializable messages, and core asks its host for what needs the app
(sign-in sessions, pickers, notifications) the way the web's worker asks its page
(`apps/web/src/web/protocol.ts`). Phase 0 starts with both sides in one runtime and measures.
If it fails the budget, core moves to a background runtime (`react-native-worklets`' Bundle
Mode: a second Hermes on its own thread, with `fetch`; stable since June 2026 but still marked
experimental by Expo, and it needs the native pieces reachable from that runtime, to verify)
and only the bridge's transport changes. Yielding between batches in core's sync loops helps
either way. In one runtime the bridge (`packages/mobile/src/bridge.ts`) still copies calls,
results and events with `structuredClone`, as the other hosts' messages are copied, so core and
the screens share no objects and core can move to its own runtime later; on a Debug build the
copying doesn't measurably lengthen the JavaScript thread's longest block while an agent streams.

Measured in phase 0, Otter Agents over the fake on the iPhone 17 Pro simulator, Release build
(the self-test's numbers; a long task is a 10 ms interval's lateness, and timers fire on frames,
so about 7 ms is the floor):

- Cold start: the JavaScript starts 1.7 s after the process (React Native's and Expo's native
  start, before any of ours), core is ready 120 ms later, and the chats are listed 17 ms after
  that: 1.8–2.0 s to the list. On a fresh install the first sync of the fake's ten chats adds
  about 310 ms: 2.2–3.2 s.
- The longest JavaScript-thread block from its start to the list: 22–37 ms warm, 28 and 113 ms
  on two fresh installs.
- While a scripted agent streams a reply (a word every 28 ms, three tool steps) into the chat
  store: 9–25 ms, 7–8 ms at the 95th percentile.
- Debug builds, for comparison: 54–73 ms while streaming, 783 ms at start.

## The interface

- **Navigation and chrome**: Expo Router on native stacks, sheets and toolbars; its zoom
  transition from a list row to the reader; `places.ts`'s paths as the routes, so links mean
  the same on every app. Both apps draw their own bottom bar today (no `TabView` in Otter
  Mail), so the pill, the sliding tab row, scrubbing across it and tucking it away on scroll
  are `expo-glass-effect`'s glass views with Reanimated and Gesture Handler, not the system
  tab bar. iOS 27 makes iPhone apps resizable and orientation locks unreliable; both apps are
  portrait-only today.
- **Tokens**: `pnpm design:tokens` resolves `tokens.css` and `globals.css` (`var()` followed,
  `color-mix()` mixed, the contrast layer at its default) into `design/tokens.json` and into
  `packages/ui-native/src/tokens.ts`: typed data, per design (Otter's for now; Margin is one
  more entry) the colors in hex for light and dark, the radius scale and the fonts, beside the
  type scale and spacing, under the CSS names in camelCase (`colors.mutedForeground`,
  `radius.lg`, `text.body`, `space[3]`). `@otter/ui`'s test fails when it is stale. The phone's
  look is an override of the same names in `packages/ui-native/src/phone.ts`: `Palette.swift`'s
  white and pitch-black canvases and iOS greys (and Otter Agents' chat states), code in SF
  Mono, and each type step's iOS text style and size, so text keeps scaling with Dynamic Type.
  `useTheme()` (`theme.ts`) gives a component the tokens for the scheme the app is in; the
  System / Light / Dark preference sets that scheme with `setSchemePreference`
  (`Appearance.setColorScheme`). Themes on the phone later are more of the generated data,
  their oklch colors through `theme-display.ts`'s existing conversion.
- **Styling**: React Native's `StyleSheet` over those typed tokens; no Tailwind on native
  (Uniwind and NativeWind were considered). The native components are their own
  implementations, not `@otter/ui`'s markup run elsewhere, so what carries over is the tokens
  and the names (components, variants, tokens), not the class strings or `cva` variants.
- **Components**: `@otter/ui-native` has Button, Input, Switch, Avatar, Badge, Chip, Alert,
  EmptyState, Toast, Spinner, Text and the settings rows under their `@otter/ui` names, and
  the phone's own patterns (the bottom bar, sheets, list rows, swipe rows, bubbles). Menus,
  dialogs, selects and popovers are the system's. `design/otter.pen` gains phone frames, and
  the design-sync rules cover both.
- **Mail bodies**: HTML mail in a web view. The web reader's body pipeline (the dark-mode
  recoloring, collapsing quoted HTML, inline images, phone numbers, link interception) is DOM
  code in `message-reader.tsx`; carved out, it can run inside the phone's web view as an Expo
  DOM component, which closes "quoted text collapsed: plain text only" for free. To verify:
  height and scrolling with twenty messages in a conversation, and reporting the selection.
- **Composer**: plain text first, as today. Rich text is the web's tiptap editor in a DOM
  component later; the signature editor the same.
- **Chat transcript**: native text, not a web view. `react-native-enriched-markdown` renders
  Markdown through TextKit with streaming, selection and custom selection-menu items (our
  Reply). To verify: selecting across blocks, tables and code blocks. The fallback is our
  `MarkdownView.swift` wrapped as a native view.
- **Lists**: a recycling list (FlashList or Legend List), `react-native-keyboard-controller`
  for the composer that follows the keyboard, `expo-haptics`, SF Symbols.

## What stays Swift

About 3,000 lines, out of about 31,000:

- **Both notification service extensions**, as they are. An extension can't host the app's
  JavaScript, and Otter Mail's design depends on it: the phone fetches the one message from
  Gmail, Graph or IMAP itself, so the relay never sees mail. It keeps `NotificationShared/` and
  the four IMAP files it compiles. They move to `targets/` (`@bacons/apple-targets`'
  `notification-service` type, as Expo's own notification tester does).
- **One native module per app**, built on that same Swift so the app and its extension can't
  drift: the Keychain items and App Group files they share, token refresh under the
  cross-process lock, the mail socket, charset decoding, Translation, the App Store
  environment check for the demo, Quick Look. For Otter Agents: the agents' pictures for
  notifications, the 25-second background grace, Talk's audio (`TalkAudio.swift`: voice
  processing, 24 kHz PCM, marks and barge-in) and the browser's page view (`BrowserPage.swift`:
  zoom, gesture mapping, the keyboard proxy). Talk's and the browser's protocols come from
  `extensions/openclaw/core`; only the audio and the canvas are native.
- `expo-secure-store` can't replace the Keychain code: the extension reads the same items, and
  its key names (`google-refresh-token:<email>`) aren't ones it accepts.

## Building, testing, releasing

- **Projects**: continuous native generation. `ios/` is generated by `expo prebuild` and not
  committed; native changes are config plugins, `targets/` and the module. Development builds,
  not Expo Go.
- **Monorepo**: pnpm and Metro work together since SDK 54; packages are read as TypeScript
  source through `exports`. One React for the workspace (19.3, through the catalog). The
  shared packages stop using Vite's `import.meta.env` and `define` globals.
- **Dev**: `pnpm dev:mobile:mail` and `pnpm dev:mobile:agents` through `scripts/dev-runner.ts`, with
  the same data as the other apps: `:fake` (core's fake, no network), `:demo`, and
  `--relay local`.
- **Tests**: logic is tested where it lives, in vitest. The Swift cases with no TypeScript
  twin are ported first (alias mailboxes, archive and undo, paging, the chat store's 28, agent
  sync's 13). The extensions' Swift tests stay with their Swift, as a package. Screens:
  Maestro flows over the fake, replacing `AppearanceUITests`, `SignInCodeUITests` and the
  17-step walkthrough, with screenshots in light and dark.
- **CI**: typecheck, lint and tests on Linux; prebuild and an unsigned build on the Xcode 27
  runner; the self-test in the simulator.
- **Releases**: the Release workflow stays, with its certificates, profiles and App Store
  Connect key. `scripts/release-ios.ts` runs `expo prebuild`, then the same archive and export
  with `xcodebuild` for the app and its extension, then dSYMs and source maps to Sentry. The
  version comes from the app config instead of a `perl` rewrite of the Xcode project. EAS
  Build isn't needed. `release-plan.ts` changes: a phone app now ships when core, the client
  package or an extension changes, which is most merges, so the phone moves to nightly-style
  batching like the desktop.
- **Later, optional**: over-the-air updates (`expo-updates`), which would ship JavaScript-only
  fixes without a TestFlight build.

## Phases

### 0. Foundations and gates

Each item ends in a yes or no. Nothing later starts before these.

1. An Expo app in the workspace that builds on the CI runner and runs from `pnpm dev:mobile:agents`.
2. Core on Hermes: the Platform over SQLite, files and the Keychain; the table above closed;
   `startCore` over the fake; mail listed and a chat opened from core through the bridge.
3. The threading budget: the fake at 50,000 messages, first sync and steady state, while
   scrolling. No JavaScript-thread block past 50 ms, 16 ms at the 95th percentile. Cold start
   to the first list within reach of today's app.
4. Tokens and styling: five `@otter/ui-native` components from the real tokens, light and dark.
5. The feel, side by side with today's apps on a phone: the glass bar with its tab row; a row
   zooming into the reader; a streaming transcript with selection, Reply and the composer on
   the keyboard; an HTML conversation scrolling.
6. A signed TestFlight build with a notification extension, from the existing workflow.

If 5 fails, the fallback is not to stop sharing: SwiftUI screens over core in an embedded
JavaScript engine get layer 1 without Expo. It is the worse outcome (two UI languages stay),
so the gate is there to find out early.

### 1. Otter Agents

First, because it needs the least of the host (no raw sockets, no mail store, no HTML mail, an
extension that fetches nothing) and has the most duplicated logic.

1. The agent logic out of `apps/web/src/main/agent` into `@otter/client`: `chat-store.ts`
   behind adapters for storage, presence, toasts, links and the notification picture (today it
   imports `react-dom`); `chat-shelves`, `chat-runs`, `scheduled-text`, `chat-context`. The web
   app imports them from there; nothing changes for it.
2. The extensions on Hermes: Hermes's event stream, OpenClaw's socket and device key, the
   varys SDK. Verified on the real gateways (`pnpm agents-server`), as any client change is.
3. Screens, in order: sign-in; chats (shelves, rows, swipes, search); a chat (transcript,
   composer, approvals and questions, the queue); the agent picker; settings and each kind's
   pairing; Scheduled; details and files; notifications; the browser; Talk; the demo.
4. Parity is `docs/features.md`'s Otter Agents table, row by row.
5. TestFlight under `dev.otterware.agents`; `apps/ios-agents` is deleted.

It also gains what the port lacks, because the TypeScript has it: a Hermes turn picked up after
leaving, deliveries, forks.

### 2. Otter Mail

1. The rest of the host: the socket, Google and Microsoft sign-in, push registration, the
   extension's configuration, background refresh (`expo-background-task`), local alerts,
   Translation.
2. The mail logic into `@otter/client`: `mail/api.ts`, `mail/hooks.ts`, the helpers, and the
   reply, forward and day-grouping code from `message-reader.tsx` and `message-list.tsx`
   (done: `mail/reply.ts`, `mail/rows.ts`, `mail/format.ts`).
3. Screens: welcome; the list (rows, swipes, days, selection); the bar, places and the mailbox
   switcher; the reader; compose; search (core's full-text search and the providers'); settings
   and its panes; Send to agent, with the same link Otter Agents reads.
4. The extension, verified on a phone as `apps/mail-mobile/README.md` lists: live APNs, a locked
   phone, revocation, the first unlock after a restart.
5. Parity is the iPhone column of `docs/features.md`. TestFlight under `dev.otterware.mail`;
   `apps/ios`, `scripts/dev-ios.ts` and `scripts/export-ios-resources.ts` are deleted.

### 3. What the phone gets for the screens alone

Core already does these; each needs only its phone UI: invitation cards and RSVP, sender
photos, snooze, send later and undo send, synced drafts, label editing, Empty Trash, views,
themes, rich text, then Todoist, Calendar and Drive. Order by `docs/features.md`'s "Gaps worth
closing".

## Switching over

The Expo Agents release uses the existing `dev.otterware.agents` App Store record.
Its development builds use `dev.otterware.agents.dev`. The signed TestFlight upgrade,
production push delivery, and phone checks for Talk and the live browser are still open.
Otter Mail will keep its own App Store record when it moves to Expo.

Otter Agents' Keychain items keep their service (`dev.otterware.agents`) and names, which core's
match (`otter-session`, `agent:<id>:<name>`), but not all of their values (checked in phase 0):

- Hermes's `key`, OpenClaw's `token` and `bootstrap-token` and varys's `token` are the same
  plain strings in both.
- `otter-session` is the bare session token in the Swift app and `{ token, user }` in core: the
  first launch of the Expo build signs people out.
- OpenClaw's `device-key` is CryptoKit's raw private key in base64 in the Swift app and a JWK in
  core, and its `device-token` the bare token (with `device-scopes` beside it) where core keeps
  `{ token, scopes }`.
- The Swift app keeps the device-only pairings (OpenClaw's, varys's grant)
  `AfterFirstUnlockThisDeviceOnly`; the module writes every item `AfterFirstUnlock`.

Nothing reads the Swift forms (alpha: no migration code). The first Expo build asks people to
sign in to Otter again, and core takes a saved value it can't parse as absent, so an OpenClaw
agent makes a new device key and pairs again.

## Risks

| Risk                                                                 | What bounds it                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core on the JavaScript thread makes scrolling stutter                | gate 3; the bridge keeps the move to a second runtime cheap                  |
| The feel falls short of SwiftUI (glass, transitions, text selection) | gate 5, on a phone, before any screen is built                               |
| Hermes gaps surface late                                             | the self-test, in CI                                                         |
| The app and its extension disagree about credentials                 | one Swift implementation, compiled into both                                 |
| Background refresh in JavaScript gets less time than Swift did       | measure in phase 2; alerts for connected mailboxes don't depend on it        |
| Two component sets drift from the design file                        | same names, same tokens, design-sync                                         |
| More dependencies, and Expo's release cadence (three SDKs a year)    | Expo's own packages first; a short list; the workspace's minimum release age |
| Bundle Mode is young                                                 | only needed if gate 3 fails                                                  |

## Decided

1. **No Android.** Where our Swift already does the job (the mail socket, Talk's audio, the
   browser's page view, the Keychain), it is wrapped, not replaced by a cross-platform library.
2. **Order.** Otter Agents, then Otter Mail.
3. **Releases.** Our workflow with `expo prebuild`, not EAS Build; over-the-air updates later.
4. **The bar.** Today's design, reproduced; gate 5 judges it.
5. **Names.** `apps/mail-mobile`, `apps/agents-mobile`, `packages/client`, `packages/ui-native`,
   `packages/mobile`.
6. **A clean end state.** Each step refactors what it touches: logic moves to where both apps
   import it, and what it replaces is deleted in the same change.

## References

- [Expo SDK 58](https://expo.dev/changelog/sdk-58)
- [Expo's fetch, streams and built-in globals](https://docs.expo.dev/versions/v58.0.0/sdk/expo/)
- [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Apple targets for Expo](https://github.com/EvanBacon/expo-apple-targets)
- [react-native-worklets, Bundle Mode](https://docs.swmansion.com/react-native-worklets/docs/bundleMode/usage/)
- [expo-crypto](https://docs.expo.dev/versions/latest/sdk/crypto/)
- [react-native-enriched-markdown](https://github.com/software-mansion/enriched-markdown)
- [react-native-audio-api's recorder](https://docs.swmansion.com/react-native-audio-api/docs/inputs/audio-recorder/)
