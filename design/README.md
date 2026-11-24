# Design

`otter.pen` is Otter's design file ([pen.dev](https://pen.dev)): the tokens, every component
and the screens built from them. It draws the same design system the code is built from,
`@otter/ui` ([packages/ui](../packages/ui/README.md)), under the same names. Its text is made
up (Robin Otter at Northwind and the repo's other made-up people and companies): never paste
real mail, names or addresses into it.

## How it stays in sync

**Tokens: the code leads.** The tokens live in `packages/ui/src/styles/tokens.css` (colors,
light and dark) and `globals.css` (radius and type scale). `pnpm design:tokens` resolves them
(var() followed, color-mix() mixed) into `tokens.json`, the variables `otter.pen` uses, one
per token under the same name (`canvas`, `foreground`, `muted-foreground`, `primary`,
`radius-lg`, `text-body`, `space-3`…). A test (`packages/ui/src/tokens.test.ts`) fails when
`tokens.json` is stale. To change a token, change the CSS, run `pnpm design:tokens`, then load
`tokens.json` into the file:

```js
// In pen.dev's execute (the Pencil MCP, or `pen interactive --in design/otter.pen --out design/otter.pen`)
SetVariables(/* the contents of design/tokens.json */, false)
```

Merging keeps the canvas-only variables, named `pen-*` (sample data colors: label and event
tints, avatar fills, the email body's white). Every other variable is a token: never add one
in the file alone. To rename a token, add the new name first, move the references, then
remove the old one; a reference to a variable that doesn't exist yet turns into a fixed color.

**Themes: an axis beside light and dark.** A theme sets every token, not only colors. Each
variable in `tokens.json` carries a value per `theme` (`otter`, the default, and `margin`) as
well as per `mode`; a frame wears one with `theme: { mode, theme }`, and a frame that doesn't
say is Otter. In code the same tokens are `tokens.css`: the stock blocks are Otter, and
`html[data-design="margin"]` (with `.dark` and the sidebar's scope) is Margin, which the Margin
theme sets on `<html>`. A component reads what a theme can change from tokens (`$font-reading`,
`$radius-pill`, `$overlay-edge`); the overlays' shadow is `pen-shadow`, transparent in Margin.
`Pages · Margin theme` is today's pages in Margin.

**Components: one name, one file.** A component in the file is named after the code that
draws it (`Button / outline`, `SidebarRow / selected`, `Chip / folder`); variants follow the
component's props. A design change lands in both: the file and the component's file below. A
new component starts in `@otter/ui` when more than one screen will use it, else in the app.

| In `otter.pen`                                                                                      | In code                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Button / outline, primary, secondary · IconButton                                                   | `packages/ui/src/components/button.tsx`                                                |
| Avatar / xs, sm, md, lg × square, round                                                             | `packages/ui/src/components/avatar.tsx`                                                |
| Badge                                                                                               | `packages/ui/src/components/badge.tsx`                                                 |
| Chip / folder, recipient, file                                                                      | `packages/ui/src/components/chip.tsx`                                                  |
| Kbd                                                                                                 | `packages/ui/src/components/kbd.tsx`                                                   |
| Switch / on, off                                                                                    | `packages/ui/src/components/switch.tsx`                                                |
| ToggleGroup / segmented                                                                             | `packages/ui/src/components/toggle-group.tsx`                                          |
| Alert / warning                                                                                     | `packages/ui/src/components/alert.tsx`                                                 |
| EmptyState                                                                                          | `packages/ui/src/components/empty-state.tsx`                                           |
| Command / commands, people, prompt · CommandItem                                                    | `packages/ui/src/components/command.tsx`, `apps/web/src/main/mail/command-palette.tsx` |
| SidebarRow / default, selected · SidebarSection · SidebarPicker / mail, calendar, agent             | `packages/ui/src/components/sidebar.tsx`                                               |
| Popover / event · Guest Row                                                                         | `packages/ui/src/components/popover.tsx`, `apps/web/src/main/calendar/event-panel.tsx` |
| Message / read, unread, selected · Group Header · Date Divider · List Header · Message List         | `apps/web/src/main/mail/message-list.tsx`                                              |
| Mail Sidebar · Sidebar Footer                                                                       | `apps/web/src/main/mail/app-sidebar.tsx`                                               |
| Reading Toolbar · Sender Header · Email Frame · Attachment Chip · File Row                          | `apps/web/src/main/mail/message-reader.tsx`                                            |
| Details Card · Attachments Card · Person Row                                                        | `apps/web/src/main/mail/conversation-summary.tsx`                                      |
| Recipient Field · Reply Composer                                                                    | `apps/web/src/main/mail/recipient-input.tsx`, `composer-kit.tsx`                       |
| Invite Card                                                                                         | `extensions/calendar-invites/ui/invite-card.tsx`                                       |
| Upcoming Event · Day Group · Upcoming Panel · Panel Header                                          | `apps/web/src/main/calendar/agenda.tsx`                                                |
| Calendar Sidebar · Mini Calendar · Calendar List Item                                               | `apps/web/src/main/calendar/calendar-sidebar.tsx`                                      |
| Week Grid · Calendar Event · Day Header                                                             | `apps/web/src/main/calendar/time-grid.tsx`                                             |
| Calendar Toolbar                                                                                    | `apps/web/src/main/calendar/calendar-view.tsx`                                         |
| Chat Panel · Chat Header                                                                            | `apps/web/src/main/agent/chat-window.tsx`                                              |
| Chat Composer · Chat Send Button                                                                    | `apps/web/src/main/agent/chat-composer.tsx`                                            |
| User Message · Agent Message · Work Summary · Work Log · Tool Step · Message Meta · Message Actions | `apps/web/src/main/agent/chat-transcript.tsx`                                          |
| Agent Sidebar · Thread Item                                                                         | `apps/web/src/main/agent/agent-sidebar.tsx`                                            |
| Agents Tab                                                                                          | `apps/web/src/main/agent/agent-corner.tsx`                                             |
| Agent Avatar                                                                                        | `apps/web/src/main/agent/agent-icon.tsx`                                               |
| Browser Tab · File Viewer                                                                           | `apps/web/src/main/agent/chat-workspace.tsx`, `agent-browser.tsx`                      |
| Task Group Header · Task Row · Detail Field · History Run · Tasks Toolbar                           | `apps/web/src/main/agent/agent-scheduled.tsx`                                          |
| App Shell · Calendar Shell · Agent Shell · Window Controls                                          | `apps/web/src/main/root-view.tsx`, `home-view.tsx`                                     |

## Editing the file

Open it in pen.dev, or drive it from an agent with the Pencil MCP (`file://…/design/otter.pen`)
or the `pen` CLI (`pen interactive`, signed in with `pen login` or `PEN_CLI_KEY`). Save before
committing: the file is the commit.
