# Otter Agents for iPhone

Your agents, on their own: the chats of the Mac and web apps' Agent mode, and what the agents run
on a schedule, without the mail. A native SwiftUI app for iOS 27 (Liquid Glass), the sibling of Otter Mail
for iPhone (`apps/ios`): the phone gets an app per job. It shares that app's
themes, and the Otter account's chats with every other app.

## Design

WhatsApp's iPhone app, in Otter's face and themes (the theme's accent where WhatsApp has its
green), since a chat with an agent is a chat:

- **The frame.** T3 Code's: the system's tab bar, Liquid Glass as iOS 27 draws it, its tabs
  icons only (Chats, with how many are unread; Scheduled; Settings), and compose (a new chat, or
  a task on Scheduled) as the prominent tab, its own circle at the bottom right. Each tab is its
  own stack; the bar leaves while a chat is open or chats are being selected (`Home/RootView.swift`).
- **Chats** (`Home/ChatsScreen.swift`). T3 Code's header: "Otter Agents" small, search and ⋯
  (Select chats, Read all, the agent to show, On your agents). The shelves as chips: Active
  (unsent drafts and pinned on top; with how many want you), Snoozed, Settled
  (`Chats/ChatShelves.swift`, apps/web's chat-shelves.ts). A row a chat, as T3 Code's: the title
  and one quiet line under it. You talk to one or two agents across many chats, so the agent's
  mark is small beside the time, and only when there are several. The line says what
  the chat is doing, the most pressing first: an approval or a question (in the warning color,
  with a badge), a failure, a reply lost mid-way, compacting, waiting on subagents or working (in
  the accent, as WhatsApp's "typing…", with how long and what's queued), a draft, then the last
  message: yours with its ticks, the agent's (a dot and a bolder title while unread), a scheduled
  run's or one the agent sent on its own, or that you stopped it. Pinned, snoozed (when it wakes)
  and "on a Mac" sit beside any of these. Swipe left to settle (with Undo) or snooze, or to wake
  or unsettle; right to mark read or pin; touch and hold for a preview and the rest; select
  several to settle, read or delete them.
- **A chat** (`Chat/ChatScreen.swift`). The agent's picture, the chat's name and its status
  under it in the header; a wallpaper of the app's own symbols; a pill for each day. Your
  messages in the accent's bubbles on the right, with their time and ticks (one sent, two
  received, colored once answered); the agent's answer on the left, a bubble a paragraph (a list,
  code, a table each one), its work in a pill above ("Worked for 2m 3s", tap for the steps).
  **Swipe any bubble right to reply to it**: just that paragraph is quoted in a bar over the
  composer, with who said it. The composer is WhatsApp's: ＋ (photos, camera, documents, skills,
  the agent, in a panel where the keyboard was), the text in a pill with the agent's picture to
  change it, and Send.
- **Type and color.** Inter (`Theme/Design.swift`), the account's themes for its colors
  (`apps/ios`'s `Theme.swift`, shared); the bubbles and wallpaper are mixed from them.

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
  T3 Code's phone app does; Stop ends the wait, and so does a message sent meanwhile, which
  is a turn of its own.
- **What the agent asks** takes the composer's place (`Chat/AskCards.swift`): approvals (once,
  for this chat, always, deny) and questions (options, your own words, skip).
- **The transcript** (`Chat/Transcript.swift`, `Chat/MarkdownView.swift`): Markdown with tables,
  code blocks and images; steps by kind with their output, grouped by integration; what Otter's
  tools changed; scheduled results and messages the agent sent on its own. Text is selectable
  within a bubble, and **Reply** on a selection, or swiping the bubble, cites it in your next message.
- **The composer** (`Chat/Composer.swift`): photos, the camera and files (10 a message; images
  to 10 MB, files to 50 MB), `/` for the agent's skills, the agent and model picker with
  favorites (`Chat/ModelSheet.swift`), drafts kept per chat.
- **Files where the agent runs** (`Chat/FileScreen.swift`, `Agents/OpenClawFiles.swift`): a file an
  OpenClaw agent links, or lists in a chat's details, is read from its gateway (the Mac and web
  apps' `readFile`) and opens here: text with line numbers, Markdown as it reads, anything else
  in Quick Look, with copy and share. Images it links show in the answer.
- **Mail from Otter Mail** (`Account.open`, `apps/ios`'s `MailContext.swift`): its Send to agent
  opens this app with a link (the scheme is this app's bundle id) naming conversations, a message,
  a draft or the words selected in one. A new chat opens with them attached, as chips in the composer; the message sent
  carries the pointer (account, thread, subject, sender, message ids) and the agent reads the
  mail itself, as from the Mac and the web.
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
  (`infra/relay`'s `apns.sendAgent`). A notification service extension reads the reply, question
  or approval directly from the agent using this iPhone's Keychain credentials, then shows the
  chat title, agent and status, and a plain-text preview. If the agent is unreachable, the
  cached chat title and status still show. Sign-out or turning notifications off clears the
  extension's configuration. A tap opens the chat, read from the gateway. Nothing is pushed for a chat one of the account's devices has on screen and in front:
  every app tells the relay which chat that is over its events socket (`Relay.watching` here,
  core's `setWatching` on the Mac and the web), again every 30 seconds, and the relay forgets a
  device that stops saying it. On in Settings; it needs the gateway's Otter
  channel (set up on the Mac: Settings › OpenClaw › Messages from your agents) or, for varys,
  the pairing this app makes itself. A finished run notifies on OpenClaw only (its plugin, from
  0.2.7): Hermes and varys tell the relay of what they deliver or ask, not of a reply to you.
- **The agents' own sessions** ("On your agents" on the list): chats started in an agent's own
  app open here and go on.
- **OpenClaw's live browser** (`Browser/`, `Agents/OpenClawBrowser.swift`; apps/web's
  agent-browser.tsx, laid out as T3 Code's phone browser preview): a globe in the capsule above
  the composer, once the chat's agent has a tab, opens the tab it's driving: the gateway's
  screencast, with the agent's pointer over it. **Take control** sends your taps, scrolling and
  typing to the page (the gateway's Otter plugin replays them) and gives you the address, Back,
  Forward, Reload, Paste, the page's pop-ups and its file picker; the agent's browser waits until
  you release it or leave. The keyboard comes up for a field of the page with the plugin from
  0.2.8, which says when one has focus. Nothing streams while the app is in the background.

## How it works

- `Account/`: the Otter account. Signing in is Google's ID token, with Otter Mail's "iOS" OAuth
  client (`GoogleSignIn.swift`: no mail scope, nothing kept but the relay's session). `Relay.swift`
  is the relay as far as the agents need it; `Account.swift` keeps the account's settings (the
  `assistant` section and the `ui` keys the other apps use) and chats in step, both ways.
- `Agents/Agents.swift`: how this iPhone reaches each agent. Hermes's settings and sealed key
  follow the account; OpenClaw and varys
  pair with this iPhone as a device of its own, kept in its Keychain. Their clients are `Clients/` (`Hermes`, `OpenClaw`, `Varys*`), compiled into
  the app and its notification extension.
- `Agents/AgentRunner.swift`: a turn on each agent, told as the `ChatEvent`s core's providers
  emit. OpenClaw and varys go on without the app: a turn the app left is picked up on return.
- `Demo/`: the demo's pretend agent and chats, offered on the welcome screen of builds that
  aren't the App Store's. It asks for an approval when a message says "send", a question when
  it says "plan", fails on "fail", works longer on "take your time", and hands off to a
  subagent and waits for it on "background". Its browser is one drawn page (`DemoBrowser.swift`).

What it leaves to the other apps: the mail itself (a conversation or draft a chat used opens the
chat in Otter on the web), and Claude and Codex (they run on a Mac: their chats read here). The live browser shows one
tab, at the size the agent's browser has. Pinch to zoom; drag to pan while watching, or use two
fingers to pan while controlling (one finger scrolls the page). There is no list of tabs.

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
"Otter Agents App Store" and "Otter Agents Notifications App Store" profiles. See [docs/release.md](../../docs/release.md#otter-agents).
