<p align="center">
  <img src="assets/prod/otter-macos-1024.png" width="128" height="128" alt="" />
</p>

<h1 align="center">Otter</h1>

<p align="center">
  <b>Your daily work, with your agents.</b><br />
  Mail, calendar, files and tasks in one calm app, and the agents you already use working right
  beside you. On the Mac, Linux, the web and the iPhone.
</p>

<p align="center">
  <a href="https://otterware.app">otterware.app</a> ·
  <a href="https://github.com/otterware-app/otter/releases/latest">Download</a> ·
  <a href="https://otter.otterware.app">Open in your browser</a> ·
  <a href="https://otterware.app/mail/changelog/">Changelog</a>
</p>

Otter is made of **modules**, the areas of your work. **Plugins** bring their features, UI and
agent tools, and connect your accounts through **connectors**. Your own **agents** work across
all of it, with the same tools you use.

| Layer      | Today                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Agents     | Claude Code, Codex, OpenClaw, Hermes, varys, and any agent on your Mac that speaks MCP          |
| Modules    | Mail, Calendar, Drive, Tasks; Code soon                                                         |
| Plugins    | Sign-in codes, Calendar invitations, Translation, Todoist, Otter Drive (`extensions/`)          |
| Connectors | Gmail, Outlook, IMAP, Google Calendar, Todoist, Otter Drive, an OpenClaw gateway, Hermes, varys |

## Modules

**Mail**: Gmail, Outlook and IMAP from a local cache, made for the keyboard.

- Several mailboxes side by side, with Gmail labels, Outlook folders and categories, and saved
  views that filter across all of them
- A local SQLite cache with full-text search, so mail opens instantly and works offline
- New mail the moment it lands, with notifications, a Dock unread badge, and iPhone alerts for
  verified arrivals (previews fetched on the phone)
- Send later, snooze, undo send, one-click unsubscribe, sign-in codes copied in a click
- On-device translation (Apple Translation on the Mac, Chrome's built-in translator on the web;
  nothing leaves your device)
- A browser beside your mail on the Mac, with Chrome Web Store extensions such as 1Password
- Keyboard shortcuts for everything, editable in Settings

**Calendar**: every Google and Outlook calendar in one week, beside your mail. Day, week and
month views; draw, drag and resize events; Meet, Teams, Zoom and Webex with Join; Yes, No and
Maybe in place; teammates' calendars over yours.

**Drive**: [Otter Drive](https://otterware.app/drive/), versioned documents for people and
agents, as a module beside Mail: every drive, previews, edits, versions and sharing, and
attachments saved straight from an email. Also a drive of its own at drive.otterware.app.

**Tasks**: turn an email into a Todoist task in a keystroke, with its link back, and work
through today's list without leaving your mail.

## Agents

Bring your own. Otter is where you see them, answer them and hand them work.

- Claude Code and Codex on your Mac, OpenClaw and Hermes on your own gateway, and your varys agent
- A chat over the mail in front of you (⌘I), or a workspace with everything it read and made in
  tabs; chats follow your Otter account to every device
- Otter's tools for mail, calendar, themes and views, asking before anything it can't undo
- Otter's tools for any other agent on your Mac (Cursor, a terminal's Claude Code, …) over MCP,
  with a read-only, safe or full-access token
- **Scheduled** (coming to Agents): what your agents run on a schedule lands in Otter, each run
  in its own chat. It already works with OpenClaw through Otter's channel
  (`extensions/openclaw/gateway`).

## Desktop app and web app

Both run the same app and the same backend (`packages/core`); what a browser can't do is
switched off in the web app.
Mac releases support Apple Silicon Macs (arm64).

| Feature                                                       | Mac app                                     | Web app in Chrome                              | Web app in other browsers                      |
| ------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Several mailboxes, labels, saved views across them            | ✓                                           | ✓                                              | ✓                                              |
| Read, search, compose, drafts, attachments                    | ✓                                           | ✓                                              | ✓                                              |
| Calendar invitations answered in place, one-click unsubscribe | ✓                                           | ✓                                              | ✓                                              |
| Local cache                                                   | ✓ every message, readable offline           | ✓ lists and opened messages, in the browser    | ✓ lists and opened messages, in the browser    |
| New mail in seconds (Gmail push)                              | ✓ also with the window closed               | ✓ while a tab is open                          | ✓ while a tab is open                          |
| New-mail notifications                                        | ✓                                           | ✓ while a tab is open (browser permission)     | ✓ while a tab is open (browser permission)     |
| Unread badge                                                  | Dock                                        | Tab title (and the app badge, where supported) | Tab title (and the app badge, where supported) |
| Otter account: mailboxes on every device, device list         | Optional                                    | Required (it keeps the Gmail sign-ins alive)   | Required (it keeps the Gmail sign-ins alive)   |
| Settings, views, theme, agent settings on every device        | With an Otter account                       | ✓                                              | ✓                                              |
| Signatures, kept in Gmail                                     | ✓                                           | ✓                                              | ✓                                              |
| Gmail sign-in                                                 | Tokens stay on your Mac                     | Through our relay (tokens pass, never stored)  | Through our relay (tokens pass, never stored)  |
| Keyboard shortcuts, edited in Settings                        | ✓                                           | ✓                                              | ✓                                              |
| Launch at login                                               | ✓                                           | –                                              | –                                              |
| Default mail app (mailto: links)                              | ✓                                           | –                                              | –                                              |
| On-device translation                                         | ✓ Apple Translation                         | ✓ Chrome's built-in translator                 | –                                              |
| Agents                                                        | Claude Code, Codex, Hermes, OpenClaw, varys | Hermes, OpenClaw, varys                        | Hermes, OpenClaw, varys                        |
| Drag attachments out to Finder                                | ✓                                           | –                                              | –                                              |
| Updates                                                       | Automatic                                   | Always the latest                              | Always the latest                              |

## Install

On the iPhone, [Otter Mail](apps/ios/README.md) (the iPhone app keeps that name) supports background notifications after connecting
each mailbox in Settings. Gmail and Outlook request separate limited permissions; IMAP asks
to store its password securely. Message content is fetched directly on the phone for previews.

Download the latest DMG (Mac) or .deb (Debian, Ubuntu: `sudo apt install ./Otter-*.deb`)
from [Releases](https://github.com/otterware-app/otter/releases).
Installed apps update themselves from the same page. Or open
[otter.otterware.app](https://otter.otterware.app) in your browser.

## Develop

```sh
corepack enable
pnpm install
pnpm dev
```

See [docs/development.md](docs/development.md) for the full setup and
[docs/release.md](docs/release.md) for how releases are cut. Contributions are welcome;
start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Otter's agents owe the most to [T3 Code](https://github.com/pingdotgg/t3code), by the T3 team
(T3 Tools Inc.). Otter's Agents, with Otter Agents on the iPhone, are modelled closely on it: T3 Code for the agents that do the rest of your work. The
chats, their queue, search and layout are our code written after theirs; the color themes and
their editor are ported from it. We'd rather follow what they got right than invent something
worse. Otter is not affiliated with or endorsed by T3 Tools.

What Otter includes from T3 Code and others, with their licenses, is in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE). Code from other projects keeps its own license:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
