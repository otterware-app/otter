# Features

Every user-facing feature and where it works, checked against the code. Mac and Web are the
same renderer (`apps/web`) over core, so they match unless noted; the iPhone app is its own
Swift code (`apps/ios`). Gmail, IMAP and Outlook are noted where they differ
([Outlook](outlook.md): Microsoft Graph, on Mac, Linux, web and iPhone).
The Mac app supports Apple Silicon Macs (arm64).
The Linux app is the same desktop app; it matches the Mac column except where
[Linux](#linux) says otherwise.

✓ supported · — not supported · a note means partly, or differently

An app shows only what it supports: what it doesn't have isn't listed, switched off, or pointed
to another app. This page is where they're compared.

## Linux

A .deb for Debian 12+ and Ubuntu 22.04+ (x64 and arm64), installed with apt, updating itself
from GitHub Releases. Everything in the Mac column works the same, except:

| Feature                    | Linux                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Window                     | frameless; minimize, maximize and close over the top bar's right end                        |
| Shortcuts                  | Ctrl where the Mac uses ⌘, in shortcuts and clicks (shown so everywhere)                    |
| Closing the window         | quits (no Dock to bring it back); launching it again opens it                               |
| Open at login              | ✓ (an XDG autostart entry)                                                                  |
| Default mail app           | ✓ (xdg; the list is the apps that open mailto: links)                                       |
| Dock badge                 | —                                                                                           |
| Translation                | — (no on-device translator)                                                                 |
| Tabs out into windows      | — (reorder only: Wayland doesn't let an app move its windows)                               |
| Saved passwords and tokens | the desktop's keyring (GNOME Keyring, KWallet); elsewhere sealed with an app key, as Chrome |
| Updates                    | the .deb; "Restart to update" asks for the admin password (not installed on quit)           |
| Feedback to a local agent  | ✓ (x-terminal-emulator, or a chosen terminal)                                               |

## Getting started

| Feature                                                             | Mac                      | Web | iPhone              |
| ------------------------------------------------------------------- | ------------------------ | --- | ------------------- |
| Setup: a mailbox, the look, notifications, the agent, keys practice | ✓ (plus login, mail app) | ✓   | welcome screen only |
| Tour of the app on your own mail (⌘K, Settings → General)           | ✓                        | ✓   | —                   |

## Mailboxes & accounts

Settings › Connections lists every account you've connected and what each gives Otter:
Google and Microsoft (Mail · Calendar), IMAP (Mail), then other services (Todoist: Tasks). Add
account offers each kind.

| Feature                                                                                                                                                  | Mac                | Web                                 | iPhone                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------- | ----------------------- |
| Add a Gmail mailbox (Google sign-in)                                                                                                                     | ✓ (loopback OAuth) | ✓ (popup; tokens kept by the relay) | ✓ (PKCE)                |
| Add an IMAP mailbox, servers discovered                                                                                                                  | ✓                  | ✓ (no domain autoconfig file: CORS) | ✓                       |
| Add an Outlook mailbox (Microsoft sign-in)                                                                                                               | ✓ (loopback OAuth) | ✓ (popup; tokens kept by the relay) | ✓ (PKCE)                |
| Provider icons in mailbox settings (Gmail, Outlook, iCloud, IMAP)                                                                                        | ✓                  | ✓                                   | ✓ (iCloud's: IMAP's)    |
| IMAP through the relay tunnel                                                                                                                            | — (direct)         | ✓ (TLS 1.3 servers only)            | — (direct)              |
| Several mailboxes: on/off, reorder (drag the sidebar's tabs; alias mailboxes anywhere)                                                                   | ✓                  | ✓                                   | ✓ (aliases by parent)   |
| One sidebar: mailbox tabs                                                                                                                                | ✓                  | ✓                                   | — (bar menu)            |
| Modes at the sidebar's foot: Mail, Calendar, Drive, Agent (G M, G C, G D, G A); each its own sidebar, back where it was; drag to reorder (this computer) | ✓                  | ✓                                   | —                       |
| ⌘-click a place (folder, conversation, chat, mode, Settings), or right-click → Open in New Window: a new window                                          | ✓                  | ✓ (browser window)                  | —                       |
| Sidebar: each mailbox opens to its folders and labels; views                                                                                             | ✓                  | ✓                                   | — (bar menu)            |
| Sidebar hidden: hover the window's edge to peek                                                                                                          | ✓                  | ✓                                   | —                       |
| Rename and color a mailbox (synced)                                                                                                                      | ✓                  | ✓                                   | ✓                       |
| Own mailbox for a Send from address (IMAP): a tab, filtered folders, name, color, signature; synced                                                      | ✓                  | ✓                                   | ✓ (made on Mac, web)    |
| A message Bcc'd to two of your addresses: a copy in each alias mailbox, shown once elsewhere                                                             | ✓                  | ✓                                   | ✓                       |
| The parent without its alias mailboxes' mail (a switch; synced)                                                                                          | ✓                  | ✓                                   | —                       |
| Google profile picture per mailbox                                                                                                                       | ✓ (kept current)   | ✓ (kept current)                    | —                       |
| Your own picture for a mailbox (Settings › Connections; synced, over Google's)                                                                           | ✓                  | ✓                                   | shown                   |
| Your own picture for an alias mailbox (its settings; synced with its parent)                                                                             | ✓                  | ✓                                   | shown                   |
| Remove a mailbox (unlinks it everywhere)                                                                                                                 | ✓                  | ✓                                   | ✓                       |
| Mailbox linked elsewhere shows "signed out"                                                                                                              | ✓                  | ✓                                   | ✓                       |
| Sync health at the foot of the sidebar, Sync now                                                                                                         | ✓                  | ✓                                   | ✓ (tap to sync)         |
| Refused sign-in: toast and card to sign in again                                                                                                         | ✓                  | ✓                                   | ✓ (banner on the list)  |
| Missing permission (calendar, Gmail signatures): "Needs permission", Settings › Access, an Allow button                                                  | ✓                  | ✓                                   | —                       |
| Demo mailbox                                                                                                                                             | —                  | `pnpm dev:fake` only                | TestFlight / Xcode only |

## Reading

| Feature                                                                                | Mac                                                                      | Web                                                                 | iPhone                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Conversations, earlier messages collapsed                                              | ✓                                                                        | ✓                                                                   | ✓                                                                   |
| A link for each mailbox, conversation and Settings page; Back / Forward                | ✓ (⌘[ ⌘], mouse buttons, Logi Options+'s swipes)                         | ✓ (the browser's; a reload keeps your place)                        | —                                                                   |
| HTML mail, inline (cid) images                                                         | ✓                                                                        | ✓                                                                   | ✓                                                                   |
| Remote images                                                                          | load; broken ones proxied by backend                                     | load; proxy only where CORS lets                                    | load                                                                |
| Remote-image blocking                                                                  | —                                                                        | —                                                                   | —                                                                   |
| Select and copy message text: a word, a sentence, any range                            | ✓                                                                        | ✓                                                                   | ✓                                                                   |
| Phone numbers in a message: click for Call, Send Message, Copy                         | ✓ (Linux: Copy)                                                          | ✓ (Call and Message on a Mac)                                       | ✓ (the system's: tap to call, hold for more)                        |
| Quoted text collapsed                                                                  | ✓ (HTML and plain text)                                                  | ✓                                                                   | plain text only                                                     |
| Attachments                                                                            | preview in app (⌘F finds), save, open in default app, drag out to Finder | preview in app (⌘F finds), save                                     | Quick Look, save / share                                            |
| Unsubscribe (one-click, web, mailto)                                                   | ✓                                                                        | ✓                                                                   | ✓                                                                   |
| Conversation summary (people, files, list)                                             | ✓                                                                        | ✓                                                                   | —                                                                   |
| Sender hover card (write, search, ask)                                                 | ✓                                                                        | ✓                                                                   | —                                                                   |
| Sign-in code card (the code a verification email carries; Copy & trash)                | ✓                                                                        | ✓                                                                   | ✓; in the reader, and on list rows for half an hour                 |
| Gmail category chips                                                                   | Gmail                                                                    | Gmail                                                               | —                                                                   |
| Folders: Inbox, Starred or Flagged, Sent, Drafts, Important, All, Archive, Junk, Trash | ✓ (Gmail: Starred, Important, All; Outlook, IMAP: Flagged, Archive)      | ✓ (Gmail: Starred, Important, All; Outlook, IMAP: Flagged, Archive) | ✓ (Gmail: Starred, Important, All; Outlook, IMAP: Flagged, Archive) |
| Print, show original                                                                   | —                                                                        | —                                                                   | —                                                                   |

## Organizing

| Feature                                  | Mac                                                                | Web                             | iPhone                                                   |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------- |
| Archive, trash, restore, junk / not junk | ✓                                                                  | ✓                               | ✓                                                        |
| Delete forever                           | ✓                                                                  | ✓                               | ✓                                                        |
| Empty Trash / Empty Junk                 | ✓                                                                  | ✓                               | —                                                        |
| Star (flag), read / unread               | ✓                                                                  | ✓                               | ✓                                                        |
| Mark all as read                         | —                                                                  | —                               | ✓                                                        |
| Multi-select and bulk actions            | ✓ (⌥/⇧-click, ⇧↑/⇧↓)                                               | ✓                               | ✓ (archive, trash, read, labels/folders)                 |
| Undo and redo (z ⌘Z, ⇧Z ⇧⌘Z)             | ✓                                                                  | ✓                               | Undo archive/trash (6 seconds)                           |
| Apply / remove labels                    | ✓ (IMAP: move to folder; Outlook: categories, or move to a folder) | ✓                               | ✓ (IMAP: move; Outlook: categories, or move to a folder) |
| Create, rename, delete labels            | ✓ (IMAP: folders; Outlook: categories; folders rename, delete)     | ✓                               | —                                                        |
| Label colors                             | edit (Gmail; Outlook: its preset colors)                           | edit (Gmail, Outlook)           | shown (Gmail, Outlook)                                   |
| Nested labels                            | ✓                                                                  | ✓                               | —                                                        |
| Drag conversations onto labels           | ✓                                                                  | ✓                               | —                                                        |
| Swipe actions                            | —                                                                  | —                               | ✓ (archive right, trash left)                            |
| After archive: next / previous           | ✓                                                                  | ✓                               | ✓                                                        |
| Snooze                                   | ✓ (on this device, while open)                                     | ✓ (on this browser, while open) | —                                                        |

Outlook messages live in one folder and can have several colored categories. Its sidebar lists
Folders and Categories in separate sections on every app. On Mac and web, Move to lists folders;
Categorize lists categories. Applying a category keeps the message in
its folder. Deleting an Outlook folder moves it and its mail to Deleted Items.

## Extensions

Sign-in codes, Calendar invites, Translation, Todoist, Otter Drive and the agents (the Otter agent, Hermes,
OpenClaw, Claude, Codex) are built-in extensions (`extensions/`). Settings lists them by kind,
under "Extensions": Agents (with chat's own settings above them), Integrations (hidden while it has
none) and Features, each row with its switch; a service you sign in to (Todoist, Otter Drive) is a connection,
listed in Connections beside the mailboxes. One with something to set up opens to its page: its switch, where its data
goes, and its settings. Turning a feature off hides it everywhere (the choice follows the Otter
account); turning an agent off stops chats on it.

| Feature                                                                                    | Mac | Web                    | iPhone |
| ------------------------------------------------------------------------------------------ | --- | ---------------------- | ------ |
| Settings: Agents, Integrations, Features; a switch on each, a page for those with settings | ✓   | ✓ (no Claude or Codex) | —      |

## Todoist

Implementation boundaries and removal steps: [Todoist feature guide](integrations/todoist.md).

Connect with Todoist in Settings → Integrations (browser consent with PKCE), or use a personal
API token. Credentials stay on each device; OAuth tokens refresh automatically. Todoist data
is fetched on demand and needs an internet connection. In `pnpm dev:fake`, Connect with Todoist
opens a pretend account, or use token `demo`; no requests are sent to Todoist. Demo filters
support search, today, overdue, 7 days, priorities and labels with `&` / `|`.

| Feature                                                           | Mac          | Web | iPhone |
| ----------------------------------------------------------------- | ------------ | --- | ------ |
| Browser sign-in, API token, reconnect, disconnect                 | ✓            | ✓   | —      |
| Create tasks from email (reader toolbar and reader/list menus)    | ✓            | ✓   | —      |
| Title, notes, project, natural-language due date, priority        | ✓            | ✓   | —      |
| Labels, project sections, shared-project assignees                | ✓            | ✓   | —      |
| Edit tasks, move projects/sections, reschedule or clear due dates | ✓            | ✓   | —      |
| Add/remove timed reminders from the task editor                   | ✓            | ✓   | —      |
| Clickable link back to the email in Otter                         | ✓ (web link) | ✓   | —      |
| Browse active tasks by project, load more, refresh                | ✓            | ✓   | —      |
| Today & overdue, Upcoming (7 days), search and Todoist filters    | ✓            | ✓   | —      |
| Complete tasks (recurring tasks advance to their next occurrence) | ✓            | ✓   | —      |
| Open task in Todoist, create a task without an email              | ✓            | ✓   | —      |
| Command palette: Browse Todoist tasks                             | ✓            | ✓   | —      |

Reminders are delivered by Todoist using the user's notification settings and account
entitlements. Create the task first, then add a reminder in Edit. OAuth uses Todoist's public
client registration, so no client secret is bundled. The web callback is shipped with the site;
the Mac app receives its callback on a temporary localhost listener.

## Otter Drive

Implementation boundaries and removal steps: [Otter Drive feature guide](integrations/otter-drive.md).

Drive is a workspace beside Mail, Calendar and Agent (its mark at the sidebar's foot, ⌘K's "Open
Drive", `/drive/<folder>/<document>`), laid out like Otter Drive: the sidebar picks a drive (My
Drive, your shared drives, Shared with me) with Mail's mailbox picker, filters it (Type, Updated
this week, Archived), searches it, and lists its folders and documents; the main area shows the
open document, or the drive's documents as a grid of thumbnails, with the folder's path above and
its sort (last updated, name). Every kind Otter Drive shows:
Markdown, text, CSV/TSV and Excel workbooks (with their sheets) drawn in the app's style; videos,
images, pages, sites of several files, PDFs and the rest from Drive's content host. A document renames in place,
switches versions, copies its link or a prompt for an agent, downloads (its file, or a site as a
zip), takes a new version, moves to another of your folders, archives and restores, and once
archived deletes for good, from its More menu or a right-click. Folders are made, renamed, moved
and (empty) deleted the same way; files upload by picking or dropping. ⌘K finds documents in the
drives that are on.

Share (a document's Share button, or Share… on a document or folder) is Otter Drive's dialog: add
people by email (suggested from the people you work with) as viewers or editors, notify them with a
message, change or remove anyone's access, leave something shared with you, and set general access
(restricted, or anyone with the link, viewing or editing). A shared drive's Manage members… adds
and removes its members the same way. Drive's links in an email (a shared link, a document, a
folder) open in Drive; a shared link adds what it shares to Shared with me first.

Text and Markdown (with the page beside it), CSV, TSV and Excel workbooks (a grid, every sheet)
edit in place: Edit, then Save makes a new version (a workbook keeps its values; formatting and
formulas aren't kept). An earlier version shown from the version menu becomes current again with
Make current.

Drive keeps a little on the device, as mail does: the lists last seen show at once (and stay when
Drive can't be reached) while they're fetched again, and text, tables and workbooks opened before
open from disk by version (the oldest go past 500 MB). Signing out clears it.

Sign in from Drive or Settings → Connections (a code confirmed in the browser). Settings lists your
drives with a switch each: a drive that's off is hidden in Drive, can't be saved to, and is refused
to anything else asking (agents included). Each drive opens its own page there, as in Otter Drive: its
name (a shared drive's owner renames it), your access, its members, its storage (its owner
connects Amazon S3, Google Cloud Storage, Azure, Cloudflare R2 or any S3-compatible bucket, checks
it, replaces its keys, chooses where new uploads go, disconnects it), transferring it to a member,
and deleting it once empty. New shared drive… makes one; Agents shows the otterdrive CLI's setup and
your API keys (create, copy once, revoke). "Save to Otter Drive…" in a message's menu saves an
attachment, or the email as a page, into the drive you pick. The sign-in and the switches stay on
this device (this browser, on the web: Drive's API answers otter.otterware.app with a token, never
cookies).

| Feature                                             | Mac | Web | iPhone |
| --------------------------------------------------- | --- | --- | ------ |
| Drive workspace: drives, filters, search, documents | ✓   | ✓   | —      |
| Previews, versions, rename, archive, upload         | ✓   | ✓   | —      |
| Folders: new, rename, move, delete; sort; path      | ✓   | ✓   | —      |
| Download, move, new version, delete permanently     | ✓   | ✓   | —      |
| Documents in ⌘K                                     | ✓   | ✓   | —      |
| Share: people, roles, notify, link access, leave    | ✓   | ✓   | —      |
| Drive links in mail open in Drive                   | ✓   | ✓   | —      |
| Edit text, Markdown, CSV/TSV, workbooks             | ✓   | ✓   | —      |
| Make an earlier version current                     | ✓   | ✓   | —      |
| Drives on or off (Settings)                         | ✓   | ✓   | —      |
| Drive settings: name, members, storage, transfer    | ✓   | ✓   | —      |
| New shared drive, delete a drive                    | ✓   | ✓   | —      |
| API keys and CLI setup for agents                   | ✓   | ✓   | —      |
| Save an attachment or the email to a drive          | ✓   | ✓   | —      |

## Chats

Agent chats follow the Otter account: every chat, whatever agent ran it, reads the same on
every device, with the conversations, drafts, pages and files it used and made. The relay keeps
them, transcripts included (step outputs clipped, image thumbnails left on the device that sent
them); without an Otter account they stay on the device. Claude and Codex run on one Mac: their
chats read the same everywhere and continue on that Mac.

| Feature                                                                                         | Mac                 | Web                  | iPhone                                     |
| ----------------------------------------------------------------------------------------------- | ------------------- | -------------------- | ------------------------------------------ |
| Small window over the mail (⌘I), the mail on screen as its context                              | ✓                   | ✓                    | — (a sheet)                                |
| Bottom bar: minimized chats as tabs (working, waiting, finished), Agent                         | ✓                   | ✓                    | —                                          |
| Chat history from the bottom bar                                                                | ✓                   | ✓                    | the Agent tab (chats: swipe from the left) |
| AI workspace (Agent in the sidebar): recent chats, the chat, its tabs                           | ✓                   | ✓                    | the Agent tab                              |
| Chats sorted like Otter Code's: Snoozed, Settled (synced)                                       | ✓                   | ✓                    | —                                          |
| Open the small window's chat in the workspace (⌘⇧F, and back)                                   | ✓                   | ✓                    | —                                          |
| Tabs: conversations and drafts it was given, read or made; files                                | ✓                   | ✓                    | —                                          |
| Tabs: pages it read, events it made, links clicked in it                                        | ✓                   | — (links: a new tab) | —                                          |
| The tab showing is the next message's context                                                   | ✓                   | ✓                    | —                                          |
| Tabs: reorder by dragging, Control + Tab for the last one, × closes                             | ✓                   | ✓                    | —                                          |
| Chat details (also in the small window): agent, session, Scheduled tasks, what it made and read | ✓                   | ✓                    | —                                          |
| Chat details beside the chat when there's room, else a popover; ⌘F finds in the chat            | ✓                   | ✓                    | —                                          |
| Synced through the Otter account: chats, transcripts, tabs                                      | ✓ (offline: queued) | ✓                    | ✓ (no tabs)                                |
| Claude and Codex chats: read everywhere, continued on their Mac                                 | ✓                   | ✓ (read)             | ✓ (read)                                   |
| Another agent's chat (Hermes, OpenClaw, OpenRouter): continued                                  | ✓                   | ✓                    | ✓ (that agent picked)                      |
| ⌘K: go to a chat, new chat; Recently viewed                                                     | ✓                   | ✓                    | —                                          |

## Composing & sending

| Feature                                | Mac                                                                                                                               | Web      | iPhone                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| New, reply, reply all                  | ✓                                                                                                                                 | ✓        | ✓                                              |
| Forward                                | ✓ (with attachments)                                                                                                              | ✓        | last message, with attachments                 |
| Cc / Bcc                               | ✓ / ✓                                                                                                                             | ✓        | ✓ / ✓                                          |
| From: pick the mailbox                 | ✓                                                                                                                                 | ✓        | ✓                                              |
| From: other addresses (aliases)        | Gmail: its "Send mail as"; IMAP: entered in Settings (suggested from its mail), synced; replies from the address mail was sent to | ✓        | IMAP: synced from the Mac and the web          |
| From in an alias mailbox               | new mail and replies from its address; its signature, else the mailbox's                                                          | ✓        | ✓                                              |
| Contact suggestions (from cached mail) | ✓                                                                                                                                 | ✓        | ✓ (recipient chips)                            |
| Attachments (25 MB)                    | ✓                                                                                                                                 | ✓        | ✓ (Photos / Files)                             |
| Rich text (bold, lists, links, quotes) | toolbar and shortcuts: bold, italic, underline, size, color, links, nested lists (Tab, Shift+Tab), quotes, undo                   | ✓        | —                                              |
| Drafts                                 | autosaved, conflict-aware                                                                                                         | ✓        | local autosave/recovery; mailbox save on close |
| Undo send (10 s)                       | ✓                                                                                                                                 | ✓        | —                                              |
| Send later                             | ✓ (on this device, while open; Outlook: by Outlook)                                                                               | ✓ (same) | —                                              |
| Signatures                             | Gmail: saved in Gmail; IMAP, Outlook: synced preference                                                                           | ✓        | ✓ (same)                                       |
| Handles mailto: links                  | ✓ (default mail app)                                                                                                              | —        | —                                              |

On iPhone, Compose sits at the list's top right. In a conversation, tap the compact Reply button to
reply to the sender, or hold it for Reply, Reply all and Forward; Trash sits beside Archive.

Scheduled sends and snoozes work with Gmail, IMAP and Outlook on Mac and web. The queue is local to
that device/browser, survives restarts, and runs overdue actions when the app next opens. Outlook's
scheduled sends are the exception: Outlook holds them and sends them on time, with the app
closed; the queue only lists them, to cancel.
Snooze is available in the reader toolbar and a conversation's right-click menu.
“Scheduled & snoozed” appears only when the queue is nonempty and lists every mailbox's
pending actions: cancel a send to restore its
contents to Drafts, or return a snoozed conversation to Inbox early. A failed or interrupted
send stays there for review; check Sent before sending again, since delivery may be uncertain.
So does a send from the composer whose answer never came and that Otter couldn't find in
Sent ("May have been sent — check Sent before sending again."); its draft stays, and cancelling
restores nothing twice. On Mac and web, Send sends the composer's saved draft itself (Gmail's
drafts.send, Outlook's draft, IMAP then deleting its versions), so no draft is left beside the
sent mail; an Outlook scheduled send is that draft, held by Outlook.
These are Otter actions, separate from Gmail's own scheduled and snoozed folders.

## Search

| Feature                        | Mac                                                                                                     | Web | iPhone                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------ |
| Gmail: server search           | ✓ (all Gmail operators, paged; local when offline)                                                      | ✓   | ✓ (25 results, plus local)                 |
| IMAP: local search             | ✓ (in: from: to: subject: is: has: after: before: newer_than: older_than:)                              | ✓   | ✓ (from: to: subject: label: is: has:)     |
| Outlook: server search         | ✓ (Outlook's search; from: to: cc: subject: has: after: before: newer_than: older_than: in: is: label:) | ✓   | ✓ (same operators; 25 results, plus local) |
| Search chips / advanced search | ✓                                                                                                       | ✓   | —                                          |
| Search tabs in the sidebar     | ✓                                                                                                       | ✓   | —                                          |

## Calendar invitations

| Feature                             | Mac                                                                               | Web | iPhone                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- | --- | ----------------------------------------------- |
| Invitation card (what, when, where) | ✓                                                                                 | ✓   | ✓ (in Catch up, Gmail)                          |
| Yes / No / Maybe                    | Gmail: Google Calendar; Outlook: Outlook calendar; IMAP: email reply to organizer | ✓   | ✓ (Gmail: Google Calendar; a series as a whole) |
| Google's RSVP links in the body     | ✓ (answered in place)                                                             | ✓   | —                                               |

## Calendar

Calendar mode (the switcher at the sidebar's foot, G C, or "Open calendar" in ⌘K): every calendar
of every Gmail and Outlook mailbox side by side (its own, shared and followed: birthdays,
holidays), grouped by mailbox as Notion Calendar does. The default calendar wears its mailbox's
color, the others their color in Google or Outlook. IMAP mailboxes have none.

On the iPhone, Calendar is a module beside Mail in the bar, Gmail mailboxes only. It reads every
Google calendar of every Gmail mailbox in one: an agenda (today first, what's over dimmed), a
day's hours (events side by side where they overlap, a line at now) and a month's grid that lists
the day picked, with ‹ › and Today. The bar's ⌃⌄ opens its calendars: All calendars, one
mailbox's, each one to show or hide, and holding one for Show only this calendar and its color
(synced with the Mac and web). An event's page puts its meeting's Join, its time and its place
first, and one of yours has Edit (title, all-day, times, calendar, place, notes); + makes a new
one. Leaving the editor with changes asks first, and so does Delete. A mailbox signed in before the iPhone asked for calendar access says so where its events
would be, with Sign in again.

| Feature                                                                                                                                                                           | Mac | Web | iPhone                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | -------------------------------------------------------------- |
| Day, week and month views; mini month and calendars in sidebar                                                                                                                    | ✓   | ✓   | Day, month and an agenda (no week)                             |
| Show or hide each calendar with its eye (Google's unchecked ones start hidden); click one for its coming events in a drawer; right-click: color, make default, show only this one | ✓   | ✓   | ⌃⌄ panel: show or hide, show only, color                       |
| Followed and read-only calendars: looked at, not changed (no drag, read-only card)                                                                                                | ✓   | ✓   | ✓ (read-only)                                                  |
| New events on any calendar that takes them (picked in the card; the default first: click a calendar's square to make it the default)                                              | ✓   | ✓   | ✓ (+; the Mac's default calendar first)                        |
| Event panel: title, time, place, notes edit in place; guests                                                                                                                      | ✓   | ✓   | Edit on the event's page (title, time, calendar, place, notes) |
| Yes / No / Maybe on invitations, with a note; repeating ones ask: this event or all events                                                                                        | ✓   | ✓   | —                                                              |
| Online meetings: Google Meet, Teams, Zoom, Webex shown with Join and copy link (also links found in an invitation's text)                                                         | ✓   | ✓   | Join (no copy link)                                            |
| Add a meeting to an event or new event: Gmail Google Meet, Outlook Teams (work and school); Meet comes off                                                                        | ✓   | ✓   | —                                                              |
| Draw or double-click a slot to create; drag to move; drag edge to resize                                                                                                          | ✓   | ✓   | —                                                              |
| New events repeat: every day, every weekday, weekly, monthly, yearly (from their start, no end)                                                                                   | ✓   | ✓   | —                                                              |
| Delete an event (Delete key or the panel)                                                                                                                                         | ✓   | ✓   | ✓ (the editor, asks first)                                     |
| Scroll sideways day by day; ‹ › and Today glide; any day can lead the week                                                                                                        | ✓   | ✓   | —                                                              |
| Teammates' calendars over yours (⌘P to add, Esc to clear): Outlook with titles they share, Gmail busy times                                                                       | ✓   | ✓   | —                                                              |
| Keys: ← → to step                                                                                                                                                                 | ✓   | ✓   | —                                                              |
| Settings → Calendar (follows your Otter account): start of week, weekends, declined events, 12 / 24-hour, a meeting on new events by mailbox                                      | ✓   | ✓   | Followed (no page of its own)                                  |

## Contacts & avatars

| Feature       | Mac                                                                               | Web | iPhone        |
| ------------- | --------------------------------------------------------------------------------- | --- | ------------- |
| Sender photos | Gmail: contacts → Gravatar → domain logo → initials; IMAP, Outlook: from Gravatar | ✓   | initials only |

## Notifications & live mail

| Feature                                                        | Mac                                         | Web                     | iPhone                                                               |
| -------------------------------------------------------------- | ------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| New-mail notifications (Off / Inbox / All), click opens it     | ✓                                           | ✓ (browser)             | ✓ (verified APNs for connected Gmail, Outlook, IMAP; local fallback) |
| Mail for an alias mailbox: named after it, opens there         | ✓ (copies of one message: once)             | ✓                       | ✓ (copies of one message: once)                                      |
| Sign-in codes in notifications                                 | ✓ (Copy & trash button; Linux: in the text) | in the text             | —                                                                    |
| An agent waiting on you (approval, question), app not in front | ✓                                           | ✓ (browser)             | —                                                                    |
| Gmail push via relay                                           | ✓ (with an Otter account)                   | ✓                       | ✓ (WebSocket + verified APNs)                                        |
| Outlook push via relay (Graph subscription)                    | ✓ (with an Otter account)                   | ✓                       | ✓ (WebSocket + verified APNs)                                        |
| IMAP IDLE                                                      | ✓ (while running)                           | ✓ (while a tab is open) | while open; server watcher for connected APNs                        |
| Background sync                                                | ✓ (15 s – 15 min, or manual)                | ✓ (while a tab is open) | BGAppRefresh, ≥ 15 min                                               |
| Unread badge                                                   | Dock                                        | tab title, app badge    | app icon                                                             |

iPhone APNs alerts require a per-mailbox background-notification connection. Gmail uses a
server metadata grant; Outlook uses a separate basic-mail grant; IMAP uses an explicitly enabled,
encrypted server password. The server confirms arrivals and checks unread/folder filters before
sending. APNs receives only identifiers and a generic **confirmed new-mail** fallback. Sender,
subject and preview are fetched directly from the provider on the phone. No server mail cache or
notification-enrichment proxy is added. Grants permit metadata access (IMAP credentials normally
permit content); they are not end-to-end encrypted against Otter. Local alerts continue for
unconnected mailboxes. Watches/subscriptions renew on the server; Off/revocation/unlink stop future
routing. Apple delivery/enrichment remain best effort, and an already submitted alert cannot be
recalled. See [behavior and setup](../apps/ios/README.md#verified-background-notifications).

## Offline & sync

| Feature                               | Mac                                | Web                    | iPhone                               |
| ------------------------------------- | ---------------------------------- | ---------------------- | ------------------------------------ |
| Local cache                           | SQLite, whole mailbox              | SQLite WASM on OPFS    | JSON, newest 400 threads per mailbox |
| Gmail: first sync                     | every row over IMAP, in seconds    | Gmail API, inbox first | newest threads                       |
| Bodies downloaded for offline         | ✓ (inbox first, then newest first) | — (fetched on open)    | —                                    |
| New mail during a long sync           | ✓                                  | ✓                      | —                                    |
| Changes applied at once, synced after | ✓                                  | ✓                      | ✓ (no outbox)                        |

On iPhone, a glass bar under a module's first page holds Mail and Calendar (when a Gmail mailbox has one), each labeled, and ⌃⌄, which opens what the one in front is scoped by: in Mail every mailbox (the one switcher), folder and label; in Calendar its calendars. Search and Settings are in the mail list's toolbar. An inbox with unread mail or invitations waiting on an answer has a Catch up pill beside All and Unread: Catch up goes through them one card at a time (Accept, Decline, Maybe for an invitation; Skip, Archive, Unsubscribe, Mark as Read for mail; swipe right to read, left to skip), the pill counting the same cards. Unsubscribe in the reader and in Catch up sends the list's mailto request itself rather than opening a draft. The Agent (with an agent on, or an Otter account's chats to read) has its own round button beside it and opens as a sheet. The bar steps aside for pages pushed over it (a conversation, an event) and for selection. Conversations zoom from their list rows (respecting Reduce Motion), the reader's navigation bar minimizes while scrolling, and selection morphs the glass buttons into bulk actions.

## Settings & customization

| Feature                                                                                                          | Mac | Web | iPhone                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | --- | --- | -------------------------------------------------------------------------- |
| 7 themes, a light and a dark pick; System / Light / Dark                                                         | ✓   | ✓   | ✓                                                                          |
| Inter, the same typeface in every app                                                                            | ✓   | ✓   | ✓                                                                          |
| App icon follows the build (stable, nightly or dev; iPhone: stable or dev)                                       | ✓   | ✓   | ✓                                                                          |
| Stable / Nightly update channel, selected in General and remembered on this computer (web: this browser)         | ✓   | ✓   | —                                                                          |
| Your own themes (Otter Code's editor): duplicate, edit, import/export                                            | ✓   | ✓   | ✓ (worn and picked; made on the Mac or the web)                            |
| Panel animations                                                                                                 | ✓   | ✓   | —                                                                          |
| Contrast, glass opacity, font size, reading width                                                                | ✓   | ✓   | —                                                                          |
| Full-width messages: content edge to edge, without the side inset (off by default)                               | —   | —   | ✓                                                                          |
| Collapsible day separators, on by default in every mail layout                                                   | ✓   | ✓   | ✓                                                                          |
| Full-width rows: the message list edge to edge with a line between, instead of cards (off by default)            | ✓   | ✓   | ✓                                                                          |
| Overlay scrollbars in the mail panes and Settings, hidden when idle                                              | ✓   | ✓   | native                                                                     |
| Unread messages on a soft background, in every mail layout                                                       | ✓   | ✓   | ✓                                                                          |
| Keyboard navigation highlights rows; Enter opens (optional open with arrows)                                     | ✓   | ✓   | —                                                                          |
| Configurable delay before keyboard previews are marked read (2 seconds by default); clicks mark read immediately | ✓   | ✓   | —                                                                          |
| Mail layouts: Auto, Split view, Full inbox                                                                       | ✓   | ✓   | —                                                                          |
| Floating reader: move, snap, resize, minimize, expand                                                            | ✓   | ✓   | —                                                                          |
| Keyboard shortcuts, rebindable (incl. move to label)                                                             | ✓   | ✓   | —                                                                          |
| Command palette (⌘K)                                                                                             | ✓   | ✓   | —                                                                          |
| Recently viewed, back and forward (Mac: title bar; web: browser's)                                               | ✓   | ✓   | —                                                                          |
| Reset customized preferences to their defaults (General, Appearance, agent preferences, mailbox name/color)      | ✓   | ✓   | —                                                                          |
| Settings search (/ or ⌘F in Settings)                                                                            | ✓   | ✓   | —                                                                          |
| Changelog (opens the site's, from ⌘K and Settings' ? menu)                                                       | ✓   | ✓   | —                                                                          |
| Views: filters across mailboxes, in the sidebar (icon or emoji)                                                  | ✓   | ✓   | —                                                                          |
| Preferences synced through the Otter account                                                                     | ✓   | ✓   | ✓ (theme, advance, mailboxes, notifications, languages, agent, signatures) |

## Support

| Feature                                                                      | Mac | Web | iPhone |
| ---------------------------------------------------------------------------- | --- | --- | ------ |
| Bug or feature feedback, platform selection, and GitHub issue review         | ✓   | ✓   | —      |
| Anonymous diagnostics and export for a coding agent                          | ✓   | ✓   | —      |
| Open a support investigation in an installed Claude / Codex terminal session | ✓   | —   | —      |
| Return local-agent drafts and findings to the report preview                 | ✓   | —   | —      |
| Download diagnostics as a file and import an agent's Markdown draft          | ✓   | ✓   | —      |
| Scrubbed error reports (Sentry), off in Settings → General                   | ✓   | ✓   | ✓      |

The support playbook covers diagnosis, duplicate detection, issue review, and
optional fix PRs. See [support.md](support.md); error reports, [error-reports.md](error-reports.md).

## Agents

| Feature                                                                                                                                                                                                                                                        | Mac                                                                     | Web                                           | iPhone                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Providers                                                                                                                                                                                                                                                      | OpenRouter, Claude, Codex, Hermes, OpenClaw                             | OpenRouter, Hermes, OpenClaw                  | OpenRouter, Hermes, OpenClaw                        |
| Chat, models, steer / stop, tool approval, history                                                                                                                                                                                                             | ✓                                                                       | ✓                                             | ✓                                                   |
| Select and copy chat text                                                                                                                                                                                                                                      | ✓                                                                       | ✓                                             | —                                                   |
| Cite part of a reply or of a file it made (PDFs too), with a comment                                                                                                                                                                                           | ✓                                                                       | ✓                                             | —                                                   |
| Changes after each agent turn, linking to results                                                                                                                                                                                                              | ✓ (Otter tools)                                                         | ✓ (OpenRouter)                                | —                                                   |
| Turn an agent off                                                                                                                                                                                                                                              | ✓                                                                       | ✓ (each)                                      | ✓ (each; their buttons go)                          |
| Chat about a conversation (pointers, not mail)                                                                                                                                                                                                                 | ✓ (also selections, quotes)                                             | ✓                                             | ✓ (a thread)                                        |
| Attach images and files to a chat                                                                                                                                                                                                                              | ✓                                                                       | ✓                                             | —                                                   |
| Assistant progress messages retained in the work toggle                                                                                                                                                                                                        | ✓                                                                       | ✓                                             | —                                                   |
| Click sent context pills to reopen a conversation                                                                                                                                                                                                              | ✓                                                                       | ✓                                             | —                                                   |
| Preview images and files linked in agent replies                                                                                                                                                                                                               | ✓ (local Claude/Codex files, OpenClaw session files, inline/web images) | ✓ (OpenClaw session files, inline/web images) | —                                                   |
| Queued follow-ups                                                                                                                                                                                                                                              | ✓                                                                       | ✓                                             | —                                                   |
| Fork a chat from a reply (OpenClaw)                                                                                                                                                                                                                            | ✓                                                                       | ✓                                             | —                                                   |
| Watch the agent's browser live (OpenClaw)                                                                                                                                                                                                                      | ✓                                                                       | ✓                                             | —                                                   |
| Scheduled tasks of every agent (a page under New chat in the Agents sidebar): list, filter by agent and status, create, edit, pause, run now, delete, past runs; results to Otter, any channel the agent has, or a webhook (OpenClaw; Hermes: to Otter or not) | ✓                                                                       | ✓                                             | —                                                   |
| Take control of the agent's browser (OpenClaw)                                                                                                                                                                                                                 | ✓                                                                       | ✓                                             | —                                                   |
| See the agent's pointer in its browser (OpenClaw)                                                                                                                                                                                                              | ✓                                                                       | ✓                                             | —                                                   |
| Mail tools (OpenRouter; Claude, Codex on Mac)                                                                                                                                                                                                                  | ✓ (every mailbox)                                                       | ✓ (OpenRouter)                                | ✓ (OpenRouter; read, search, draft, send, organize) |
| Calendar tools (OpenRouter; Claude, Codex on Mac)                                                                                                                                                                                                              | ✓                                                                       | ✓ (OpenRouter)                                | —                                                   |
| Theme tools: make, change and wear themes                                                                                                                                                                                                                      | ✓                                                                       | ✓ (OpenRouter)                                | —                                                   |
| View tools: make, change and delete views                                                                                                                                                                                                                      | ✓                                                                       | ✓ (OpenRouter)                                | —                                                   |
| Tools for other agents on the Mac (MCP, token)                                                                                                                                                                                                                 | ✓ (Claude Code, Cursor, …)                                              | —                                             | —                                                   |

OpenRouter runs on Otter's server with the AI SDK on Mac, web and iPhone. Connect an
OpenRouter API key in Settings › Agents while signed in to your Otter account; the key is
sealed on the server, never synced into preferences or sent back to the apps. Available models
come from OpenRouter's account-specific catalog and must support tools. Usage draws from
OpenRouter credits. Requests exclude providers that collect user data. Chats live on the server
and can be resumed on another device; they remain until the chat or Otter account is deleted.

The apps answer the server's tool requests through their mail backends, so mailbox credentials
stay on the device. Keep an app open during a turn. Relevant mail and attachment content goes
to the agent server and OpenRouter when a tool reads it. Changes ask first in Supervised mode;
read operations and saving drafts do not. Full access skips those prompts. On iPhone, the mail
tools read and search, inspect supported attachments, save new plain text drafts, send and
queue organization changes; calendar, theme and view tools are omitted. OpenRouter
follow-ups queue on Mac/web; steering is available with Hermes. The iPhone waits for the current
OpenRouter turn to finish before another question. `pnpm dev:fake` runs the same agent runtime
on the local Vite server, with a private browser session and server-side key storage.

Claude and Codex get Otter's own tools (an MCP server in the Mac app's backend), so they
need no mail CLI: search, read and sort mail, download attachments, save drafts and send, in
any mailbox (Gmail, IMAP or Outlook), and list, add, change and answer events in Google Calendar or Outlook's calendar. A tool
that changes a mailbox asks first unless the chat has full access; drafts don't ask. They can
also make a theme or change one of the user's own, and wear a theme; a built-in never changes
(changing one makes a copy, worn in its place).

OpenClaw connects to the user's gateway over its WebSocket, as OpenClaw's own apps do (usually
`wss://<computer>.<tailnet>.ts.net`, with Tailscale Serve). Each install is a device with its own
key: a setup code from `openclaw qr` (or the gateway token) introduces it once, the user
approves it on the gateway (`openclaw devices approve`), and Settings › Agents walks through
those steps. It asks for what OpenClaw's own apps hold, `operator.admin` included,
so the gateway counts what you send as the owner's: the agent uses your paired devices (its
`nodes` tool: a Mac's shell, screen and computer use) for what you ask in Otter. Each device pairs on its own; the Hermes connection instead follows the Otter
account. The web app also
needs its site in the gateway's `gateway.controlUi.allowedOrigins`. Each chat is a gateway
session, so the gateway's other conversations can be resumed; the gateway's agents are the models
to pick, each with its picture (or emoji) from the gateway, which also marks its chats (title,
tabs, history; other providers' chats show the provider's mark) on Mac and web. Replies, tool steps, steering and command approvals come through; it works on mail with
its own skills. A run belongs to the gateway, not the app: when the connection drops it's
followed again on the next one, and a chat whose reply was cut off by quitting picks the run up
on the next launch, showing what it did meanwhile and streaming the rest (the chat says so while
the gateway is out of reach). The token and device key stay on the device. The iPhone pairs the
same way (Settings › Agents, a setup code), and picks a reply back up when it comes back to the
foreground or is opened again. When OpenClaw stops to ask something (its `ask_user`), the
question takes the composer's place, with its options and room for an answer of your own. A
device paired with fewer permissions asks the gateway for full access from Settings › Agents. A message
sent while it works steers the run, or, when the runtime can't take it mid-turn, runs right after
it, and the chat follows that too. When the agent hands off to wait for its subagents
(`sessions_yield`), the turn waits with it and shows the reply their completion brings, also
after a relaunch. A reply the agent writes on its own later (a background command or subagent
finishing, a scheduled job) appears in its chat as a turn of its own, including those written
while the app was closed. Tool steps show the tool's output.

Otter is also an OpenClaw channel, `otter` (the gateway plugin in `extensions/openclaw/gateway`,
set up from Settings › Agents › OpenClaw on Mac and web). What an agent delivers to it (a
scheduled job's `--announce --channel otter --to chat:new`, the message tool, a forwarded
approval) is kept on the gateway, in the chat it names, and notifies when no window is in front. The plugin sends the relay only a pointer (which agent, which
session, an approval's or question's id), never the text, with a token made in Settings; the
relay passes it to the account's open devices, which read the delivery from the gateway.
Like Slack's threads and channel posts, a delivery either goes to one of Otter's chats
(`--to chat:<session key>`, kept in that session) or starts a new chat each time
(`--to chat:new`, named for its scheduled task and day: "Morning brief · Sat, Nov 8"); those are
the only targets (what's sent to the owner, `otter:owner`, starts a chat too). A chat no device
has yet starts one. A chat open in the app also catches up when the gateway says its session changed,
so a scheduled job's result written straight into it shows up without a pointer. Each chat
remembers how far it has read its session (by the gateway's row numbers), so what arrived while
no device was looking shows up, in its place, even after you've written in the chat since; a
chat read for the first time catches up on the day's deliveries. What no
message of yours started carries a one-line header: "Scheduled · Morning brief · 9:00 AM" (its
schedule on hover, while the job exists; a finished one-shot is just "Scheduled"), or "Sent by
Rowan" for what the agent sent with its message tool; its notification names the scheduled task.
Something new from the agent in a settled or snoozed chat (a scheduled task still running) brings
the chat back.

With the plugin installed, what you send goes through it, as a message on the `otter` channel
from its owner (`otter.chat.send`, which needs full access) instead of `chat.send`, once
Settings › Agents › OpenClaw's "Manage every scheduled task" adds `otter:owner` to the gateway's
`commands.ownerAllowFrom` (and `plugins.entries.otter.hooks.allowConversationAccess`, so the
plugin can tell the agent, in an Otter chat, about these targets). OpenClaw lets a configured channel owner manage every scheduled task
from any chat, as from its Control UI; a `chat.send` turn sees only the scheduled tasks its own chat
made. Scheduled tasks made from a chat then deliver back to it over the channel. Without the
plugin, or before that, sends stay `chat.send`.

Hermes connects to its API server (port 8642, usually served on the tailnet), with its
`API_SERVER_KEY`, and the connection follows the Otter account. Each chat is a Hermes session,
which Hermes names itself from the first message (renaming a chat in Otter renames the session),
and each message is a run in it (`/v1/runs`), which belongs to Hermes, not the app: the reply is
followed over the run's event stream, picked up again from where it was when the connection
drops, and from its start on the next launch when the app quit during it (this device keeps the
run's id for a day; another device shows what the session holds). Replies, tool steps, steering,
stopping and command approvals (also answered elsewhere) come through.

Otter is also a Hermes platform, `otter` (the plugin in `extensions/hermes/gateway`, set up from
Settings › Agents › Hermes on Mac and web). What Hermes sends to it (a scheduled task's
`deliver: otter`, its send_message tool) is kept on Hermes as a session of its own (`otter:new`, a
new chat each time) or in the chat it names (`otter:<session id>`), and the plugin tells the
relay only a pointer, as OpenClaw's does, so the account's devices read it at once. What Hermes
writes into one of your chats on its own (a delivery to it, a background task finishing) shows up
there as a turn of its own, also when no device was looking (each chat remembers how far it read
its session). Without the plugin, a scheduled task whose results stay on Hermes
(`deliver: local`) brings each run that said something (not `[SILENT]`) to Otter as a new chat,
read once a minute. Either way the chat is "Morning brief · Sat, Nov 8", with the
"Scheduled · Morning brief" header and a notification. The Scheduled page sends a task's results
to Otter (through the plugin when Hermes has it), to another of Hermes's connected platforms
(Telegram, Slack…, to a chat you name), or leaves them on Hermes (Otter's own setting, synced
with the account: Hermes has no "nowhere"). Its past runs are its cron sessions, each with its
transcript.

Other agents on the Mac (Claude Code or Codex in a terminal, Cursor, …) get the same tools from
that server while the app is open, with a token made in Settings › Agents (its address stays the
same from launch to launch). Each token is read only, safe or full access, and nothing asks
again: safe is anything that can be undone (archive, label, trash, drafts), never
sending mail or invitations or deleting for good. Agents that run in the cloud (Langdock,
claude.ai connectors) can't reach a server on the Mac.

## Browser

The browser panel beside the mail holds pages (ChatGPT's in-app browser); ⌘⇧B shows or hides
it. Links in mail and the small chat window open there by default; Settings › Browser can send
them to the default browser instead. A chat's pages open beside it in the AI workspace (see
Chats). The pages live in a session of their own, apart from the app's. A web page can't embed
other sites, so the web app opens links in a new browser tab as before.

| Feature                                                                    | Mac | Web | iPhone |
| -------------------------------------------------------------------------- | --- | --- | ------ |
| Pages as tabs in the panel: back, forward, reload, address and search      | ✓   | —   | —      |
| ⌘F finds in the page                                                       | ✓   | —   | —      |
| ⌘W closes a page, returning to the last tab viewed; the last closes it     | ✓   | —   | —      |
| Drag to reorder tabs, Control + Tab for the last one                       | ✓   | —   | —      |
| Links in mail and chat open in a tab or the default browser; ⌘-click flips | ✓   | —   | —      |
| Start page (⌘T): new chat, extensions, suggested sites; ⌘L for the address | ✓   | —   | —      |
| Sign-in popups, links to other apps (asked first), mailto: opens a message | ✓   | —   | —      |
| Context menu, site info (clear a site's data), clear all browsing data     | ✓   | —   | —      |
| Chrome Web Store extensions: add (asked first), auto-update                | ✓   | —   | —      |
| Toolbar: pinned extensions, Extensions menu, badges, popups                | ✓   | —   | —      |
| Settings › Browser: extensions on/off, details, remove, developer mode     | ✓   | —   | —      |
| Extensions' context menu items and notifications                           | ✓   | —   | —      |
| Native messaging (an extension talking to its Mac app, e.g. 1Password's)   | ✓   | —   | —      |

Extensions install through electron-chrome-web-store (MIT) and run on Electron's extension
support, plus Otter's own layer for what Chrome has and Electron doesn't
(`apps/desktop/src/services/extensions.ts` and its preload): `chrome.action`, the rest of
`chrome.tabs`, `chrome.windows`, `contextMenus`, `notifications`, `webNavigation`, `commands`,
`permissions`, native messaging, and simple `downloads` and `privacy`. To connect 1Password to
its desktop app on Mac, add Otter in 1Password's Settings › Browser › Add Browser. It then
shares the desktop app's unlock, including Touch ID. Camera, microphone, location and
notifications are refused to pages.

## Translation

| Feature                                        | Mac                  | Web                               | iPhone               |
| ---------------------------------------------- | -------------------- | --------------------------------- | -------------------- |
| Translate a message; auto for unread languages | ✓ (Apple, on-device) | Chrome only (built-in Translator) | ✓ (Apple, on-device) |

## Mac-only

- Dock badge (off by default; Settings → General); launch at login; default mail app (mailto: links).
- Drag attachments out to Finder.
- Menus: Sync Now, Back / Forward (⌘[ ⌘]).
- Auto-update from GitHub Releases ("Restart to update"), or all at once from ⌘K ("Update Otter
  Mail": check, download, restart). The web app follows its channel's latest release: open tabs
  offer "Reload to update"; the iPhone app updates through TestFlight.

## Otter account & devices

| Feature                              | Mac      | Web      | iPhone                              |
| ------------------------------------ | -------- | -------- | ----------------------------------- |
| Otter account                        | optional | required | required (the first Google sign-in) |
| Sign out; devices, sign out a device | ✓        | ✓        | ✓                                   |
| Delete account                       | ✓        | ✓        | ✓                                   |

The Google-backed Otter identity also signs in to Otter Drive. Drive receives only identity
claims; Gmail authorization stays with Mail. Existing Mail accounts and sessions keep their IDs.
Sign-in and account management live at `accounts.otterware.app`, an independent service with
its own identity database. Mail's old endpoints remain compatible with installed clients.
The web apps automatically reuse an existing Accounts login in the same browser. **Sign out
of Otter** in either web app signs out of both Mail and Drive in that browser, including
older sessions. Other browsers, the Mac and iPhone apps, and CLI credentials stay signed in.
Accounts used by Drive are deleted through the central account page, which confirms
the effect on both apps and requires transferring or deleting owned shared drives first. Older Mail
clients receive a link to that page instead of deleting a shared identity without confirmation.

## Google OAuth scopes

What each scope in `GMAIL_SCOPES` (`packages/contracts/src/google.ts`) is for:

- `https://mail.google.com/`: every Gmail mail feature (reading, search, sending, drafts,
  labels, delete forever, push). The iPhone app asks for this one, `gmail.settings.basic`,
  `calendar.readonly` and `calendar.events.owned` (plus `openid email profile`).
- `gmail.settings.basic`: saving signatures in Gmail (reading them needs only the mail scope).
- `calendar.events.owned`: answering invitations in Google Calendar, replacing the broader
  `calendar.events` the Mac and web apps ask for today. Without it, RSVPs go by email reply. The
  iPhone also makes and changes your own events with it; without it, saving says to sign in again.
- `calendar.readonly`: every calendar on the account's list (shared, followed: birthdays,
  holidays) and teammates' busy times (⌘P). Older sign-ins see the primary calendar only; the
  calendar and Settings › Connections › Access say so, with Allow calendar access (signs in again).
  The iPhone's calendar shows nothing for those, and offers signing in again. Outlook needs nothing new for its own calendars (`Calendars.ReadWrite`);
  calendars shared with an Outlook mailbox are listed but can't be read without
  `Calendars.Read.Shared`, which isn't asked for (a refresh asking for an ungranted scope fails).
- `contacts.readonly` + `contacts.other.readonly`: contact photos for sender avatars.

## Gaps worth closing

- iPhone: Outlook calendars; answering an invitation from the reader.
- iPhone: rich text in the composer.
- iPhone: forward with the original HTML.
- iPhone: synced draft autosave and undo send.
- iPhone: sender photos (contacts, Gravatar, logos) instead of initials only.
- iPhone: create, rename and delete labels; Empty Trash / Junk.
- iPhone: views.
- Mac and web: Mark all as read (iPhone has it).
- Web: translation outside Chrome.
- Web: offline bodies (the Mac downloads them).
- iPhone: snooze and send later.
- All: remote-image blocking, print, show original.
