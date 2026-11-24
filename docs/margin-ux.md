# Margin's UX

Part B of `design/otter.pen` proposes how Otter works in the Margin theme: one column at a
reading measure (680px), a 240px margin column beside it and, in Calendar, an 80px time gutter.
Agents write in the margin beside what they're about (a serif italic note on a 2px vermilion
rule, accept ↵ / dismiss ⌫); an event, a draft or a question opens in the margin instead of a
popover or a floating window; color is kept for what needs you.

This is the order to build it in. Each step is its own PR and works in both themes; the Margin
theme (look) is already in.

## 1. Mail: the Margin layout (B3, built)

A fourth Mail layout in Settings → Appearance. The inbox is one column at the reading measure
(the list kept as in Full inbox), and the reader is the same column with the conversation's
details (`conversation-summary.tsx`, today's side card) in the margin beside it. Renderer only:
`theme/interface-settings.ts`, `home-view.tsx`, `mail/message-reader.tsx`, `styles.css`.

## 2. The margin column as a component

Before more screens use it: a `Margin` layout in `@otter/ui` (column, margin, the margin's
sticky top) and the design's Margin Note, Section Head and Button / signal, rule and ink under
the same names, so the next steps share them. Draw-to-code per the `design-sync` skill.

## 3. Mail: reply inline and compose as a page (B3)

The reply opens in the column under the last message (the inline composer, laid out at the
measure), and New message opens as a page in the column instead of today's composer pane. Renderer
only.

## 4. Mail: Ask Pilot (⌘E) in the margin (B3)

⌘E in Margin opens the agent in the reader's margin, about the open conversation, instead of
the small window over the mail (`agent/chat-window.tsx`). The chat is the same; only where it
is drawn changes. Renderer only.

## 5. Calendar: the event in the margin, ⌘K as a sheet (B4)

The week keeps its grid with an 80px time gutter; an event opens in a margin column beside it
instead of today's popover. ⌘K becomes a sheet that finds, does, or hands the question to the
agent (the command list's last row: "Ask the agent"). Renderer only.

## 6. Agent: chat as a document, Scheduled as a ledger (B5)

A chat reads as a document at the measure, with what the agent did (tools, files, sent mail)
in the margin beside the turn that did it, from the work log the transcript already has.
Scheduled becomes a ledger (when, what, last run), and a scheduled task gets a page. Renderer,
and `apps/ios-agents` follows when the layout settles (its chat is a port of the web one).

## 7. Desk, the new home (B2)

Today's mail, meetings and tasks on one running page. Needs a place in the router
(`/desk`) and a mode beside Mail, Calendar and Agent, reading what the app already caches
(mail, calendar, Todoist). Renderer, plus a read of each cache that doesn't exist yet (the
day's items across mailboxes and calendars).

## 8. Agent margin notes (B2, B3, B4)

The notes an agent writes beside a message, an event or a task ("Maya asked about Saturday:
reply yes?", accept ↵ / dismiss ⌫). **Needs backend work**: the agent must produce
suggestions tied to an item (contracts: a suggestion with its target, text and action; core:
asking the agent for them and storing them, synced like chats through the relay; the relay:
keeping them with the account's agent data). Accepting runs the action through the tools agents
already have; dismissing is remembered so the note doesn't come back.

## 9. Settings (B6)

Settings in one column at the measure, each section's help in the margin. Renderer only.
