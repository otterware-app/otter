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
