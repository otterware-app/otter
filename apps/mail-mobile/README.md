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
