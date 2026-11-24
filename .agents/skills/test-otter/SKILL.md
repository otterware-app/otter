---
name: test-otter
description: Test Otter's UI and behavior in T3's built-in Browser panel against the seeded made-up mailbox (`pnpm dev:fake`), with no Google, Gmail or Otter account of your own. Use for browser verification of any change to the renderer (apps/web) or the mail backend (packages/core).
---

# Test Otter on the made-up mailbox

Use T3's built-in Browser panel (the `preview_*` tools) for verification. If
its tools are absent or the panel reports unavailable, explain the blocker and
stop verification. Do not install or switch to another automation system.

Test against the made-up mailbox, never the user's real accounts: don't sign in
to Google or Otter, and don't use `pnpm dev` (the relay and real sign-ins) for
testing unless the change is about sign-in or the relay itself. When a change
needs real Gmail or IMAP, use the demo mailboxes instead (`pnpm dev:demo`,
docs/development.md#demo-mailboxes).

## Start the app

Reuse this task's healthy `pnpm dev:fake` server. Otherwise run `pnpm dev:fake`
from the repository root and keep its terminal session. Read the URL from its first line
(`[dev] http://localhost:<port>`): 5833 in the main checkout, another port in a
linked worktree or when 5833 is busy. The page title ends in "(demo)".

## What's in it

Three mailboxes: Personal (`demo@otter.example`) and Work (`sam@acme.example`),
on a pretend Gmail, and Contoso (`jordan.lee@contoso.example`), on a pretend
Outlook (Microsoft Graph, `apps/web/src/web/demo/outlook.ts`) with an Archive. A few weeks of mail: multi-message threads, newsletters
with unsubscribe, PDF/SVG/CSV attachments, calendar invitations (RSVP),
drafts, spam, trash, nested labels (`Projects/Otter`), non-ASCII names.
The seed is `packages/shared/src/demo-mailboxes.ts`; add to it when a flow needs
mail it doesn't have.

A pretend Gmail (`apps/web/src/web/demo/gmail.ts`) answers the backend: archive,
labels, stars, trash, send and drafts change it and its history feed, so sync
behaves as with Gmail. Search supports the common operators and free text.
It's signed in to a made-up Otter account with scripted agents, fourteen chats and
scheduled tasks (`packages/core/src/fake`: `chats.ts`, `agent.ts`,
`schedules.ts`, `files.ts`, `sessions.ts`); a message with "ask", "send", "delegate" or "fail" in it tries
questions, approvals, waiting on a subagent and failures, and "take your time" a
slow reply. Studio's chats run on its gateway agents Molty and Scout (turn one off
in its Settings page), one chat ran on a Mac's Claude, and two are on a removed
agent (Reconnect agent: "Book the venue in Alfama" moves to Studio, "Draft the
visa letters" is refused). "Get ready for Thursday's planning" used and made
eight things, has a scheduled task, and links one file of each kind. The Otter
account signs out and in again without Google and lists two other devices; rata's
scheduled tasks fail to load and varys's are read-only. Not available: a real
Otter account, Google Calendar (RSVPs go out as email replies), contact photos, new mail
arriving on its own, and Mac-only features (`features` in the web bridge).

## Use the Browser panel

Call `preview_status`, then `preview_open` if the Browser panel is closed.
Always test at a 1600x1000 viewport: `preview_resize` with
`{mode:"freeform",width:1600,height:1000}` before looking at anything (a
headless browser from the shell uses the same size).
Navigate to the dev server URL with `preview_navigate`, then use
`preview_snapshot` and T3's interaction tools. `preview_evaluate` can call the
backend directly, e.g.
`window.desktopBridge.invoke("gmail:listAccounts")`. Keep using the same tab.

## Reset

The demo's state survives reloads (its own OPFS storage, apart from real mail
on the same origin). To start over, close other tabs of the app and navigate
to the URL with `?reset-demo` appended. Don't clear site data: that would also
wipe a real dev sign-in on the same origin.

## Verify and retain

Exercise the affected flow and capture the state that proves it works; check
the console for errors. Keep the server and panel available while the user
inspects or iterates. An assistant turn ending is not teardown. Stop only
processes you started.
