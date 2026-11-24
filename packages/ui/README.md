# @otter/ui

Otter's design system: the tokens and the components every screen is built from. It follows
[shadcn/ui](https://ui.shadcn.com) (components you own, styled with Tailwind, composed from
parts) on [Base UI](https://base-ui.com) primitives. `design/otter.pen` draws the same tokens
and components; [design/README.md](../../design/README.md) is how the two stay in sync.

```
src/styles/tokens.css    the tokens: the stock palette (light, .dark, the sidebar's scope), radius, glass,
                         and each theme design's block (Margin: html[data-design="margin"])
src/styles/globals.css   Tailwind, the fonts, the contrast layer, the Tailwind theme, shared utilities
src/components/*.tsx     the components
src/lib/utils.ts         cn()
src/tokens.ts            the tokens resolved for design/tokens.json and @otter/ui-native
```

An app imports `@otter/ui/globals.css` first in its stylesheet, then adds its own `@source`.
Components are imported one file at a time: `import { Button } from "@otter/ui/components/button"`.

The iPhone apps draw with the same tokens: `pnpm design:tokens` generates them, in hex, into
`@otter/ui-native`'s `src/tokens.ts`, and the phone's own canvases, greys and Dynamic Type sizes
are an override of the same names in its `src/phone.ts`.

## Rules

- **Build from the components.** A button is a `Button` (or `IconButton`), a menu a
  `DropdownMenu`, a picker a `Select`, a modal a `Dialog`, a tooltip `HintTooltip` or
  `Tooltip`. A raw `<button>` is fine for a composite with no counterpart here (a message row,
  a calendar cell), not for an action that looks like one of these.
- **Paint with tokens.** Colors come from the token utilities (`bg-canvas`, `text-foreground`,
  `text-muted-foreground`, `text-faint-foreground`, `border-border`, `bg-accent-surface`,
  `bg-primary`, `text-destructive-foreground`…), never hex values or Tailwind's palette
  (`text-red-500`). Data colors (a label's, a calendar's, an account's) are the data's own.
- **Type on the scale.** `text-4xs` 9, `text-3xs` 10, `text-2xs` 11, `text-xs` 12, `text-body`
  13 (the body), `text-sm` 14, `text-md` 15, `text-base` 16, `text-lg` 18, `text-xl` 20,
  `text-2xl` 24 (page titles), `text-3xl` 30. No `text-[13px]`.
- **Radius on the scale.** `rounded-sm` 4, `rounded-md` 6, `rounded-lg` 8 (controls),
  `rounded-xl` 12 (menus, cards), `rounded-2xl` 16 (dialogs), `rounded-full` (circles: avatars,
  dots), `rounded-pill` (a control shaped as a pill: a pill button, a search field, a chip).
  The values are Otter's; a theme's design sets its own (Margin: 2–8, pills 3).
- **Themes set every token.** A theme is colors and, through its design, any other token: the
  fonts, the radius scale, `rounded-pill`, `shadow-overlay`, `border-overlay-edge`, glass.
  So a component takes those from tokens too: what you read (a subject, a title, an agent's
  prose, a draft) is `font-reading`, an overlay's lift `shadow-overlay`. Where a design needs a
  component to differ in a way no token says, a `margin:` variant does it (`shadow-xs
margin:shadow-none`). A new token defaults to Otter's value, so Otter never moves.
- **Hover is instant.** A row, a navigation item, a chip or a button changes on hover at once:
  no `transition-colors` (or `transition-opacity` on actions a row shows on hover). Motion is
  for what moves or opens: popups, panels, a section folding.
- **Compose with `render`.** Base UI's parts take a `render` element instead of Radix's
  `asChild`: `<DropdownMenuTrigger render={<IconButton label="More" />}>`.
- **One primitive library.** Base UI only; `radix-ui` is gone (lint refuses it).
- **Patterns live here too.** What more than one screen uses (a sidebar row, a settings row, a
  chip, a toast) is a component here, not a copy in each screen. The app keeps what only one
  screen draws (the message row, the reader, the calendar grid, the chat transcript).

## Components

| Component                                      | Notes                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button`                                       | `Button` variants `outline` (default), `primary`, `secondary`, `ghost`, `ghost-muted`, `destructive`, `ghost-destructive`, `link`; sizes `xs` 24, `sm` 28, `default` 32, `lg` 36, `xl` 40, `icon-xs`, `icon-sm`, `icon`. `IconButton` is a quiet square one with a `label`. `buttonVariants` styles a link like a button. |
| `dialog`                                       | `Dialog` with `title` (and `onConfirm`, `confirmLabel`, `destructiveAction`…) lays itself out as a confirmation; with only children it is the root for `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogClose`.                                                                                     |
| `dropdown-menu`, `context-menu`                | `DropdownMenu`, `…Trigger`, `…Content` (`side`, `align`, `sideOffset`), `…Item` (`icon`, `accelerator`, `variant="destructive"`, `onClick`, `closeOnClick`), `…CheckboxItem`, `…RadioGroup`/`…RadioItem`, `…Separator`, `…Label`, `…Group`, `…Sub`. `ContextMenu*` are the same rows, opened by a right-click.            |
| `select`                                       | `Select` (pass `items`, value → label, so the trigger shows the label), `SelectTrigger` (`variant="pill"`), `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`. `onValueChange` may pass `null`.                                                                               |
| `tooltip`                                      | `HintTooltip` (`label`, `hint`, `side`) around one element; `Tooltip`/`TooltipTrigger`/`TooltipPopup` for anything else. `TooltipProvider` sits at the app's root.                                                                                                                                                        |
| `popover`                                      | `Popover`, `PopoverTrigger`, `PopoverPopup` (`padding`, `width`, `side`, `align`), `PopoverClose`, `PopoverTitle`.                                                                                                                                                                                                        |
| `input`, `textarea`, `field`                   | `Input` (`size`, `font="mono"`), `DraftInput` (commits on Enter or blur), `Textarea` (grows with its text), `Field` (`label`, `description`, `error` around one control).                                                                                                                                                 |
| `switch`, `checkbox`, `toggle`, `toggle-group` | `Switch`, `Checkbox`, `Toggle`, `ToggleGroup` (`variant="segmented"`: the segmented control).                                                                                                                                                                                                                             |
| `avatar`                                       | `Avatar` (`size` `xs` 16, `sm` 20, `md` 28, `lg` 32, `xl` 36; `shape`), `AvatarImage`, `AvatarFallback`.                                                                                                                                                                                                                  |
| `badge`, `chip`                                | `Badge` (`outline`, `secondary`, `primary`, `destructive`, `warning`), `BadgeDot`. `Chip` (`size` `xs` a label, `sm` a recipient or filter, `md` a file; `variant`), `ChipDot`, `ChipRemove`, `chipVariants` for a button styled as one.                                                                                  |
| `kbd`                                          | `Kbd`, `KbdGroup`.                                                                                                                                                                                                                                                                                                        |
| `alert`, `empty-state`, `toast`                | `Alert` (`error`, `warning`, `info`, `success`, `sidebar`), `EmptyState` (`icon`, `title`, `description`, `actions`), `toast` (`toast.success`, `toast.error`, actions, undo) with `ToastProvider` at the root.                                                                                                           |
| `sidebar`                                      | The sidebar's parts: `SidebarBody`, `SidebarAction` (New message), `SidebarSection` (a collapsible group, `action`), `SidebarSectionAction`, `SidebarRow` (`icon`, `title`, `badge`, `dot`, `trailing`, `depth`), `SidebarBadge`, `SidebarCollapse`, `SidebarSwitcher` (mailboxes, drives), `SidebarPicker` (the spaces). |
| `settings`                                     | A settings page: `SettingsPageContainer`, `SettingsSection`, `SettingsGroup`, `SettingsRow` (`title`, `description`, `control`), `SettingsSelect`, `SettingsResetButton`, and `SettingsSearchTargetProvider`, which scrolls to and pulses a search result.                                                                |
| `command`                                      | A searchable list, always open (Base UI's Autocomplete inline): `Command` (`items`), `CommandInput`, `CommandList` (renders each item), `CommandItem`, `CommandEmpty`, `CommandLabel`.                                                                                                                                    |
| `scroll-area`, `separator`, `spinner`, `text`  | `ScrollArea`; `Separator`; `Spinner`; `Text` (`variant`, `color`).                                                                                                                                                                                                                                                        |

## Adding a component

Start from shadcn's Base UI version (`pnpm dlx shadcn@latest add <name>` with this package's
`components.json`, or copy it from ui.shadcn.com/docs/components/base), then make it Otter's:
token utilities only, the type and radius scales above, `data-slot` on each part. Draw it in
`design/otter.pen` under the same name (design/README.md).
