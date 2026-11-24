# Otter Mail for iPhone (Expo)

The Expo app uses the same mail store, sync and query hooks as the Mac and web apps. Its fake
mailboxes cover folders, scrolling and pagination, conversations, search, composing and
replying. See the [migration plan](../../docs/expo-migration.md) for work before cutover.

```sh
pnpm dev:mobile:mail:fake
```

The app runs under `dev.otterware.mail.dev`, with Metro on port 8099. Expo prebuild generates
`ios/` from `app.config.ts`.

For a development build over the 50,000-message Gmail fixture, start Metro with
`EXPO_PUBLIC_OTTER_MAIL_BENCHMARK=1` as well as `EXPO_PUBLIC_OTTER_DATA=fake`. For performance
measurements, set both during the iOS Release bundle instead. The benchmark gets separate
local data and runs the large fake inbox at the same pace as the Node benchmark. Scroll during
first sync to measure time to the first visible thread and JavaScript timer lateness. After
sync finishes, tap **Replay 200 changes** and continue scrolling for the steady-state sample.

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
