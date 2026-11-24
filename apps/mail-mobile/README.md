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

Register `"./plugins/with-mail-auth.cjs"` in `app.config.ts`'s `plugins` array. It adds the
callback schemes for the app's existing `ios.infoPlist.GoogleClientID` and Microsoft redirect
`msauth.<bundle identifier>://auth`. Keep `NotificationAppGroup` set to
`group.<bundle identifier>.notifications` on the app and extension with that App Group
entitlement. The Swift files in `packages/mobile/ios/MailShared` can be compiled into the
notification service target as well. Its credential readers call the same refresh functions and
use the same Keychain group and locks.

Mount `WelcomeScreen` from `src/account/welcome-screen.tsx` when the mailbox list is empty.
Settings can render `AccountScreen` or compose `OtterAccountSection` and
`MailboxSettingsSection` into its own page. These use the shared Otter account and Mail clients.

The production bundle reads the Swift install's mailbox metadata and Otter session before core
starts, then resumes Gmail, Outlook and IMAP from the existing shared Keychain. Core rebuilds its
mail cache from the providers. The fake uses separate data and bypasses the native Mail host.
