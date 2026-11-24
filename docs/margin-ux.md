# Margin's UX

Settings → Appearance → Layout: **Classic** (the panes) or **Margin**. Margin is how Otter works,
apart from the theme it wears (the Margin theme is its look): one column at a reading measure
(42.5rem), a margin beside it (15rem) and, where time matters, a gutter before it (5rem); agents
write in the margin beside what they're about; an event, a draft or a question opens in the
margin instead of a popover or a floating window. The design is Part B of `design/otter.pen`.

The setting is the synced preference `otter:layout`, `data-layout="margin"` on `<html>` and the
`layout-margin:` variant; the column, margin and section heads are `@otter/ui`'s `margin.tsx`.

## What it is

- **The frame**: a rail of the modes (`margin-rail.tsx`, the same list as the switcher's), a top
  bar with where you are and "Find anything, or ask the agent ⌘K". Sidebars start closed.
- **Desk** (`/desk`, `desk/`): the home in Margin. Today's meeting now, what needs you across
  mailboxes and Todoist, the rest of today's meetings, each with its agents' notes.
- **Mail**: the inbox as a page (masthead, place tabs, day sections, time in the gutter, notes in
  the margin); the reader with notes and the summary in the margin, earlier messages on a line
  each and the reply inline; New message as a page; ⌘E docks the agent beside the page.
- **Calendar**: the grid drawn Margin's way; the week's summary, notes and calendars in the
  margin; an event opens in the margin.
- **⌘K**: a sheet at the measure; "Ask the agent" hands the text to a new chat (Tab).
- **Agent**: a chat as a document, what each turn did in the margin beside it; Scheduled as a
  ledger; a task's page with its brief and history.
- **Settings**: each pane a page, each section's help in the margin.

## Agents' notes

An agent writes a note beside a conversation, an event, a scheduled task or the day
(`packages/contracts/src/margin-notes.ts`): a summary, a draft, a question or something done,
with an action to accept. Notes are kept with the account's agents and chats (`note/<id>` in
the relay's store), so every device shows the same ones; accepting starts a chat with the action,
dismissing hides it for good. Core's writer (`services/margin-notes.ts`) asks the selected agent
for them, only while the layout is Margin, an Otter account is signed in and an agent is set up:
at most every 5 minutes, about a dozen items at a time (unread inbox conversations from the last
two days, today's and tomorrow's events, scheduled tasks that failed or paused), never twice
about the same item, through a one-off request that makes no chat.

## Not yet, or not as drawn

- The Desk's greeting is `text-3xl`: the design's 52px needs a display size in the type scale.
- Mail's place tabs don't include Gmail's categories; the masthead's mailbox isn't a switcher. A
  draft has no notes (no note target for it).
- ⌘E docks beside any page, not only the reader; Escape in its input doesn't close it.
- The rail can't reorder modes (the Classic switcher can). Panes keep their own top bands under
  the top bar.
- The writer remembers what it asked on each device: two devices in Margin may each ask once.
- Otter Agents on the iPhone (a port of the web chat) follows once the layout settles.
