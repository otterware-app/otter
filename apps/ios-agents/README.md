# Otter Agents for iPhone

Your agents, on their own: the chats of the Mac and web apps' Agent mode, and what the agents run
on a schedule, without the mail. A native SwiftUI app (Liquid Glass), the sibling of Otter Mail
for iPhone (`apps/ios`): the phone gets an app per job. It shares that app's agent clients and
themes, and the Otter account's chats with every other app.

## Design

Otter Code's phone app (`apps/mobile` in otter-code), in Otter's face and themes:

- **The frame.** One stack whose root is the chosen tab. A floating glass bar at the bottom left
  holds the tabs (Chats, Scheduled, Settings), with the compose button beside it; both leave
  while a chat is open (`Home/RootView.swift`).
- **Chats** (`Home/ChatsScreen.swift`). Flat rows, a hairline between them: the agent's mark, the
  title, then what the chat is doing (Approval, Input, Working with its clock, Waiting, Failed,
  Done) or
  how long ago you were in it; under it what it used and made ("1 draft · 3 emails"). Shelves as
  on the Mac and the web (`Chats/ChatShelves.swift`, apps/web's chat-shelves.ts): unsent drafts,
  pinned, active, then Snoozed and Settled behind their headings. Swipe left to settle (with
  Undo) or snooze, right to pin; touch and hold for the rest.
- **A chat** (`Chat/ChatScreen.swift`). Your messages in bubbles on the right; the agent's answer
  plain, its work folded into "Worked for 2m 3s" once it's done. The composer is a glass pill
  over the end of the conversation, with a capsule above it for the run's clock, what's queued
  and the way back down.
- **Type and color.** Inter at Otter Code's sizes (`Theme/Design.swift`), the account's themes
  for its colors (`apps/ios`'s `Theme.swift`, shared).

## What it does

Everything the Mac and web apps' chat does that a phone without the mail can
(`docs/features.md` has the table):

- **Chats follow the account** (`Chats/ChatSync.swift`, core's services/chats.ts): the list from
  the relay's `/v1/chats`, a chat's turns when it's opened, kept on disk from then on. A change
  here is written at once and pushed soon after (a streaming turn every 15 seconds); a write the
  relay refuses as stale gives way to the account's copy. A turn keeps the fields this app
  doesn't read (`Chats/Chat.swift`), so writing a chat the Mac made loses nothing of it.
- **Any number of chats run at once**, each on the agent it started with (`Chats/ChatStore.swift`,
  apps/web's chat-store.ts): send, queue or steer (Settings › Chat; touch and hold Send for the
  other), stop, retry a failed message, edit or send now what's queued.
- **A turn that hands off stays open** (`apps/ios`'s `OpenClaw.swift`, as
  extensions/openclaw/core/openclaw.ts): when an OpenClaw agent yields to wait for its subagents
  or background commands (`sessions_yield`), the turn waits with it, and the reply their
  completion brings is part of it, also when the app left meanwhile. The capsule and the chat's
  row say Waiting, with the subagent's name when it has one ("Waiting · Research pricing"), as
  Otter Code's phone app does; Stop ends the wait, and so does a message sent meanwhile, which
  is a turn of its own.
- **What the agent asks** takes the composer's place (`Chat/AskCards.swift`): approvals (once,
  for this chat, always, deny) and questions (options, your own words, skip).
- **The transcript** (`Chat/Transcript.swift`, `Chat/MarkdownView.swift`): Markdown with tables,
  code blocks and images; steps by kind with their output, grouped by integration; what Otter's
  tools changed; scheduled results and messages the agent sent on its own. Text is selectable
  across paragraphs, and **Quote** on a selection cites it in your next message, with a comment.
- **The composer** (`Chat/Composer.swift`): photos, the camera and files (10 a message; images
  to 10 MB, files to 50 MB), `/` for the agent's skills, the agent and model picker with
  favorites (`Chat/ModelSheet.swift`), drafts kept per chat.
- **Per chat**: rename, regenerate the title, pin, snooze, settle, delete, copy the session ID,
  find in chat, and details (the agent, where it ran, what it made and read).
- **Scheduled** (`Scheduled/`): Hermes's cron jobs, OpenClaw's automations and varys's routines
  as tasks (each extension's core/schedules.ts, ported in `Schedules.swift`): run now, pause,
  edit, delete, make one, and each past run with what it wrote.
- **What an agent does on its own**: a chat is read up to date from its agent when it opens
  (`ChatStore.catchUp`): what a scheduled task or another device's turn wrote since, and, on
  OpenClaw, the approvals and questions its session waits on, which this iPhone answers though
  it started none of them. A delivery to a chat that isn't one here yet makes it, under the id
  every device gives it.
- **Notifications** (`Account.swift`, `OtterAgentsApp.swift`'s `AppDelegate`): an agent's gateway
  tells the relay it has an approval, a question or a message, or that a run in one of Otter's
  chats finished (a pointer: the agent and its session, never the text), and the relay pushes to the account's Otter Agents iPhones
  (`infra/relay`'s `apns.sendAgent`). The words are generic; a tap opens the chat, read from the
  gateway. Nothing is pushed for a chat one of the account's devices has on screen and in front:
  every app tells the relay which chat that is over its events socket (`Relay.watching` here,
  core's `setWatching` on the Mac and the web), again every 30 seconds, and the relay forgets a
  device that stops saying it. On in Settings; it needs the gateway's Otter
  channel (set up on the Mac: Settings › OpenClaw › Messages from your agents) or, for varys,
  the pairing this app makes itself. A finished run notifies on OpenClaw only (its plugin, from
  0.2.7): Hermes and varys tell the relay of what they deliver or ask, not of a reply to you.
- **The agents' own sessions** ("On your agents" on the list): chats started in an agent's own
  app open here and go on.

## How it works

- `Account/`: the Otter account. Signing in is Google's ID token, with Otter Mail's "iOS" OAuth
  client (`GoogleSignIn.swift`: no mail scope, nothing kept but the relay's session). `Relay.swift`
  is the relay as far as the agents need it; `Account.swift` keeps the account's settings (the
  `assistant` section and the `ui` keys the other apps use) and chats in step, both ways.
- `Agents/Agents.swift`: how this iPhone reaches each agent. The Otter agent runs on the relay
  (its key stays there); Hermes's settings and sealed key follow the account; OpenClaw and varys
  pair with this iPhone as a device of its own, kept in its Keychain. Their clients are Otter
  Mail's (`apps/ios/OtterMail/Agent`: `Hermes`, `OpenRouter`, `OpenClaw`, `Varys*`), compiled into
  both apps.
- `Agents/AgentRunner.swift`: a turn on each agent, told as the `ChatEvent`s core's providers
  emit. OpenClaw and varys go on without the app: a turn the app left is picked up on return.
- `Demo/`: the demo's pretend agent and chats, offered on the welcome screen of builds that
  aren't the App Store's. It asks for an approval when a message says "send", a question when
  it says "plan", fails on "fail", works longer on "take your time", and hands off to a
  subagent and waits for it on "background".

What it leaves to the other apps: the mail itself (a conversation or draft a chat used opens the
chat in Otter on the web), Otter's own mail tools for the Otter agent (they run where the mail
is), Claude and Codex (they run on a Mac: their chats read here), and OpenClaw's live browser.

## Running

```sh
pnpm dev:ios:agents               # build, then run in the simulator (production relay)
pnpm dev:ios:agents --relay local # against `pnpm dev`'s relay on :8787
```

Or open `OtterAgents.xcodeproj` in Xcode (27 or later). Debug builds are
`dev.otterware.agents.dev`, release builds `dev.otterware.agents`; the project signs with team
838JVGY7W4. On your iPhone:

```sh
xcodebuild -project apps/ios-agents/OtterAgents.xcodeproj -scheme OtterAgents -destination 'generic/platform=iOS' \
  -derivedDataPath apps/ios-agents/.build -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
xcrun devicectl device install app --device <udid> "apps/ios-agents/.build/Build/Products/Debug-iphoneos/Otter Agents.app"
```

Unit tests (`OtterAgentsTests`, Swift Testing) and the walkthrough (`OtterAgentsUITests`, which
drives the demo through every screen) run in the simulator:

```sh
xcodebuild -project apps/ios-agents/OtterAgents.xcodeproj -scheme OtterAgents \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
TEST_RUNNER_OTTER_SHOTS=/tmp/shots xcodebuild -project apps/ios-agents/OtterAgents.xcodeproj -scheme OtterAgentsUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test   # a picture per step in /tmp/shots
```

Its icons come from the agent's mark (`assets/agent/otter-agent-symbol.svg`) with
`pnpm icons:export`.

## Releasing

A merge to main that changes the app, or what it shares with Otter Mail, uploads a build to
TestFlight (the Release Otter Agents workflow; `pnpm release:ios:agents` from a Mac) and tags it
`ios-agents-vX.Y.Z`. Release builds use manual signing: the Apple Distribution identity and the
"Otter Agents App Store" profile. See [docs/release.md](../../docs/release.md#otter-agents).
