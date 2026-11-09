# Otter Mail for iPhone

A native SwiftUI app (iOS 27, Liquid Glass), the sibling of the Mac and web apps (`apps/desktop` and
`apps/web`, one TypeScript app). It shares their Otter account, mailboxes, themes and settings, not
their code.

## Design

- **Linear's frame.** The mail list is the page, with All and Unread pills under its title and
  Compose, Search and More at the top right. Under a module's first page, a glass bar
  (`Home/PlacesBar.swift`): Mail and Calendar (when a Gmail mailbox has one), labeled, and ⌃⌄ for
  what the one in front is scoped by: in Mail the mailboxes (the one switcher), the mailbox's
  folders and labels (the title opens it too); in Calendar its calendars to show or hide. Each
  module has its own navigation stack with the bar on its first page only, so a pushed page (a
  conversation, an event) never has the bar over it. The agent has its own round button beside
  the bar and opens as a sheet; so does Search. Settings is ChatGPT's grouped sheet.
  Gmail's folders include All Mail and Important; Outlook's and IMAP's an Archive of their own,
  and their Starred is Flagged (a flag, not a star).
- **The desktop's rows.** The sender's picture, who and when, the subject, a line of the latest
  message; unread mail on a soft card, read mail flat (or full-width rows, as the desktop's
  setting). Swipe right to archive, left to trash; long-press for the rest. Archive takes a conversation out of the inbox, or
  (Outlook, IMAP) out of a folder into the Archive; in the Archive it's Move to Inbox.
- **The reader's bars.** The reader
  hides the bar for compact glass buttons: Archive and Trash on the left, Reply on the right.
  Tap Reply for the sender, or hold it for Reply, Reply all and Forward.
- **The desktop's type.** Inter (`Resources/Fonts`, SIL OFL), the Mac and web apps' face, at
  iOS's text styles so Dynamic Type still scales it (`Theme/Typography.swift`). Code stays in SF Mono.
- **Every theme.** The themes are the desktop's (`Resources/Themes.json`), light and dark, blended
  the same way (`Theme/Theme.swift`).
- **App icons.** Releases (TestFlight and App Store) use the default icon, with light, dark and
  tinted appearances. Debug builds use the blue blueprint icon. `pnpm icons:export` draws both
  from the same envelope mark as the Mac and web icons. The icon follows the build.

## How it works

Like the Mac app, the phone signs in to Google and Microsoft itself and talks to Gmail and
Microsoft Graph directly, and to IMAP and SMTP servers directly too (`docs/imap.md`,
`docs/outlook.md`). Full device grants stay on-device. Explicit background-notification connections
add limited server grants (or an encrypted IMAP password), while mail content still loads directly.

- `Account/GoogleAuth.swift`: Google sign-in per mailbox with the otterware project's "iOS" OAuth
  client (no secret; PKCE; Google returns to the client ID's reversed form). Refresh tokens stay in
  the Keychain.
- `Account/MicrosoftAuth.swift`: Microsoft sign-in per Outlook mailbox (work, school and
  personal), the same app registration as the relay's, as a public client: PKCE, Microsoft
  returning to `msauth.<bundle id>://auth`. The address is Graph's `/me` `mail` (else the sign-in
  name). Microsoft rotates refresh tokens: each refresh keeps the new one in the Keychain.
- `Account/Relay.swift`: the Otter relay (`packages/contracts/src/relay.ts`). Signing in hands it
  the Google ID token (the relay accepts the iOS client's, see `GOOGLE_IOS_CLIENT_ID`); then the
  linked mailboxes, the preferences, and the `/v1/events` socket while the app is open.
- `Account/Session.swift`: the demo or the signed-in account, and keeping it in step: mailboxes
  linked on any device show here (signed out until this phone signs in to them), preferences sync
  both ways under the other apps' keys (`ui` and `settings` sections), relay events trigger syncs.
- `Mail/MailSync.swift`: sync, local-first: cached on disk, changes shown at once then written
  through the mailbox's `MailProvider` (`Mail/MailProvider.swift`, core's provider seam).
- `Gmail/`: the Gmail provider: the Gmail API (`GmailAPI.swift`), messages out (`MIME.swift`),
  history-based sync; `users.watch` is renewed daily so pushes reach the relay.
- `Outlook/`: the Outlook provider (`OutlookProvider.swift`), through Microsoft Graph
  (`GraphAPI.swift`: immutable ids, 4 requests in flight, Retry-After, `$batch`). Folders and
  categories are labels with core's ids (`OutlookFolders.swift`; the Archive is `ARCHIVE`); threads are conversations, read
  whole when any of their messages changes; each followed folder has a delta (the inbox, Sent and
  Drafts, then folders once opened). Bodies and files come from the MIME source
  (`MIMEParser.swift`); writes are PATCHes and moves, replies `createReply`, drafts updated in
  place; search is Outlook's KQL (`OutlookSearch.swift`). A Graph subscription points at the
  relay, so its `mail` events sync the mailbox while the app is open.
- `Imap/`: the IMAP provider (`ImapProvider.swift`): folders as labels (the \Archive folder, or
  one named Archive, is `ARCHIVE`; Gmail's IMAP archives into All Mail), flags, UID/CONDSTORE sync,
  IDLE on the inbox while the app is open. Its IMAP and SMTP clients run over Network.framework
  with the system's TLS (`MailSocket.swift`; STARTTLS goes through `URLSessionStreamTask`, which
  can start TLS mid-connection). `MailDiscovery.swift` finds the servers for an address (known
  providers, then Thunderbird's autoconfig, then the domain's MX host). The password stays in the Keychain; the settings
  follow the Otter account. Debug builds trust any certificate from localhost, to test against
  GreenMail or Dovecot in Docker.
- `Agent/`: OpenRouter (`OpenRouter.swift`) connects to the relay's AI SDK agent; its key and
  chats stay on the server. `AgentMailTools.swift` executes mail tools through `MailStore`,
  with approvals in the chat. Hermes (`Hermes.swift`) connects to the user's agent server;
  its settings and sealed key follow the Otter account. Both share the `assistant` settings
  section with Mac/web. OpenClaw (`OpenClaw.swift`) connects to the user's gateway over its
  WebSocket as the Mac does: this iPhone is a paired device with its own Ed25519 key (a setup
  code from `openclaw qr`, then `openclaw devices approve`); its gateway and tokens stay here. A
  run is sent with the turn's id as its idempotency key, so one the app left in the background
  (or quit during) is picked up again from the gateway's transcript. The Mac's local Codex and
  Claude providers are omitted. `AgentChats.swift` reads the account's chats (the relay's
  `/v1/chats`, every device's and agent's): one this iPhone's agent can run continues here,
  the others are read, and each finished turn is written back after the chat's other turns,
  keeping what other devices wrote (it stays the relay's JSON).
- `Calendar/`: the Calendar module, for Gmail mailboxes (`MailCapabilities.calendar`).
  It is the Mac and web apps' calendar (`apps/web/src/main/calendar`) ported to Swift: the pure
  parts file for file, the screens the phone's own. Where a phone wants more than the Mac's
  calendar says, it follows Otterware's mobile calendar (the `otter-calendar` repository). The
  test cases of both are vectors in `OtterMailTests/CalendarTests.swift` and `TimeGridTests.swift`.
  - `CalendarDates.swift` ← `dates.ts`: the modes (Day and Month, with the phone's Agenda; Week
    stays the Mac's), the week's start, stepping, a day's and a time's labels.
  - `CalendarPreferences.swift` ← `preferences.ts`: Settings › Calendar from the account's `ui`
    section (`calendar:week-start`, `show-weekends`, `show-declined`, `time-format`, `colors`),
    followed here; only a calendar's color is written back.
  - `CalendarShown.swift` ← `calendar-store.ts`: calendars shown or hidden on this device, and the
    one mailbox the bar's ⌃⌄ scopes to.
  - `EventStyle.swift` ← `event-style.ts`: an event's color and tone (filled, dashed while an
    invitation waits, struck through when declined).
  - `Events.swift` ← `month-grid.tsx`, `time-grid.tsx`, `agenda.tsx`: a day's events, the agenda
    (from the start of today, so what's over today stays, dimmed), and how a row states its time.
  - `TimeGrid.swift`, `DayGrid.swift` ← `time-grid.tsx`: the Day page's hours, overlaps side by side.
  - `GoogleCalendarAPI.swift` reads the calendars and a window of events as core maps them
    (`packages/core/src/providers/gmail/calendar.ts`); `CalendarStore.swift` keeps a window at a
    time, as `useCalendarEvents` does. The sign-in asks for `calendar.readonly`, so a mailbox signed
    in before that shows Sign in again where its events would be (core's `NoCalendarAccess`).
  - `CalendarView.swift`, `CalendarPage.swift`: the module: the agenda, the day, and the month's
    grid listing the day picked, paged sideways; `EventRow.swift` a row; `EventView.swift` one
    event, its Join, time and place first, with Edit for one of yours.
  - `EventEditing.swift` ← `event-panel.tsx` and `api.ts`: a draft's times, only what changed
    (`patch`), Google's request body as core's `apiBody` builds it, and which events are yours to
    change. `EventEditor.swift` makes and changes one, pushed over the calendar; Back with changes
    and Delete ask first. Saving needs `calendar.events.owned`: a sign-in from before says so, with
    Sign in again. `DemoCalendar.swift` is the demo's events; its changes stay in memory
    (`DemoEventWriter`).
- `Mail/`: the model and `MailStore`, which screens render from. `DemoMail.swift` loads the demo.
- Alias mailboxes (`NotificationShared/AliasMailbox.swift`, `MailStore.aliases`): an IMAP
  mailbox's address with a mailbox of its own, made on the Mac and the web (the account's
  `aliasMailboxes`; `sendAs` lists the mailbox's other addresses, which compose's From offers).
  Each is a place over its parent's cached mail, not a mailbox. `mail:mailboxes` orders it among
  every mailbox (`arrangedScopes`; a new one starts after its parent), and Settings › Mailboxes
  lists it under its parent until Edit, where anything drags anywhere. A received copy is its when one of the addresses it was delivered to (the
  topmost Original-Recipient, Delivered-To and X-Original-To) is one of the parent's Send from
  addresses: it's those aliases' alone. Otherwise (delivered to the mailbox's own address, as
  Postfix's Delivered-To says, or to none; mail cached before those were fetched) To and Cc
  decide. Sent and Drafts are what it wrote. Its list pages the parent until it has a page of
  its own. New mail there and replies go from the alias, signed
  with its signature (else the parent's); alerts are named after it and open it. The parent
  shows everything unless its "Their mail in … too" switch is off (`mail:alias-mail-apart`):
  then its lists and counts leave out the mail of its alias mailboxes that are turned on
  (`MailStore.isRest`), while the app's badge still counts it.
- `Reports/`: error reports to Sentry (`otter-mail-ios`), scrubbed by the shared rules
  (`docs/error-reports.md`): crashes and the failures of sync, sign-in, the relay and sending, with a
  random report id; off in Settings › Support. Release builds report; Debug builds only with
  `OTTER_MAIL_ERROR_REPORTS=1` in the launch environment.
- `Home/`, `Reader/`, `Compose/`, `Settings/`: the screens.

Also: Apple's on-device Translation (on request, or automatically for languages you don't read),
background refresh with notifications (Settings › Notifications) and the unread badge,
attachments in Quick Look, one-click unsubscribe, and signatures edited as Gmail keeps them.

Sign-in codes (`Mail/VerificationCode.swift`, `Reader/CodeCard.swift`): the Sign-in codes plugin's
code with Copy & trash, which copies it and trashes the conversation (with Undo).
`VerificationCode` is `packages/shared/src/verification-code.ts` ported, its cases in
`OtterMailTests/VerificationCodeTests.swift`; change both together. The reader shows a one-line
card above the message that carries the code, as the Mac and web do. A list row shows the code as
its preview line, only for half an hour after the mail arrived, since codes expire.

## Running

```sh
pnpm dev:ios               # build, then run in the simulator (production relay)
pnpm dev:ios --relay local # against `pnpm dev`'s relay on :8787
```

Or open `OtterMail.xcodeproj` in Xcode (27 or later). The welcome screen offers the demo mailbox,
the same pretend mail as `pnpm dev:fake`, plus an iCloud-style IMAP mailbox with two alias
mailboxes (`DEMO_ALIAS_ACCOUNT` in `packages/shared`); build and test against it rather than real accounts.

Debug builds are `dev.otterware.mail.dev`, release builds `dev.otterware.mail`. The Google "iOS"
client is registered for the former. The project signs with team 838JVGY7W4; to run on your
iPhone, pick it in Xcode, or from the command line:

```sh
xcodebuild -project apps/ios/OtterMail.xcodeproj -scheme OtterMail -destination 'platform=iOS,id=<udid>' \
  -derivedDataPath apps/ios/.build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <udid> "apps/ios/.build/Build/Products/Debug-iphoneos/Otter Mail.app"
```

(`xcrun devicectl list devices` gives the UDID. Without an Apple account signed in to Xcode, add
`-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID` with an App Store Connect
API key.)

Unit tests (`OtterMailTests`, Swift Testing) run in the simulator:

```sh
xcodebuild -project apps/ios/OtterMail.xcodeproj -scheme OtterMail -destination 'platform=iOS Simulator,name=iPhone 17' test
```

UI tests (`OtterMailUITests`, XCTest, against the demo mailbox) have their own scheme, so the unit
test run stays quick:

```sh
xcodebuild -project apps/ios/OtterMail.xcodeproj -scheme OtterMailUITests -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Shipping: the Release iPhone workflow builds and uploads to TestFlight (`pnpm release:ios` does
the same from a Mac); see `docs/release.md`. The app has its own version, `MARKETING_VERSION` in
the Xcode project, apart from the Mac app's.

`Resources/Themes.json` and `Resources/DemoMailboxes.json` are exported from `packages/shared` by
`pnpm ios:resources` (`dev:ios` and releases run it); rerun it after changing the palettes or the
demo mailbox.

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
`OtterMailNotificationService` fetches the indicated message **directly from Gmail, Microsoft
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

`NotificationShared/` contains the direct readers, coordinated OAuth refresh, shared Keychain and
App Group configuration. Provider secrets and access tokens live in the App Group's Keychain
group and use `AfterFirstUnlockThisDeviceOnly`: enrichment can work on a locked phone **after the
first unlock since reboot**, and falls back before that. Otter session credentials stay private to
the app. Cross-process locks serialize refresh; removal/replacement checks prevent an in-flight
refresh from restoring deleted credentials. Debug/release storage, topics and tokens are separate.

Enriched Gmail/Outlook taps open the mailbox/conversation, fetching it directly if absent from the
cache. IMAP taps resolve the notified UID into its local thread, loading the folder if needed.
Generic taps open the mailbox and sync. Notification previews render Markdown as plain text and
keep link labels. The demo needs no Google, Microsoft, IMAP, Apple or Otter credentials.

### Apple setup and verification

Register App IDs for `dev.otterware.mail.dev` / `dev.otterware.mail` and their `.notifications`
extensions. Enable Push Notifications on the **app**, and App Groups/Keychain Sharing on both
app and extension. Provision both targets for their matching group:
`group.dev.otterware.mail.dev.notifications` (Debug),
`group.dev.otterware.mail.notifications` (Release). The app-private Keychain group stays first:
it's the default group, where the Otter session is kept. The `APNS_ENVIRONMENT` build setting and signed `aps-environment` must match:
Debug `development` → sandbox; Release/TestFlight `production` → production. If signing with a
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

Run the normal Xcode build and `OtterMailTests`, including `NotificationTests` and
`VerifiedNotificationTests` (labels, routing, failures and the completion race). Check the demo in light/dark.
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
runs the native tests and captures the demo in light/dark. Linux development cannot run these
checks locally. Live APNs, extension Gmail access and signed-in notification/tap/preference
checks still require a provisioned iPhone; CI's demo screenshots do not cover them.

Sources: [Apple extension requirements](https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications),
[Apple filtering entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.filtering),
[Keychain sharing](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps),
[Gmail push/watch renewal](https://developers.google.com/workspace/gmail/api/guides/push),
[Gmail history](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list).
