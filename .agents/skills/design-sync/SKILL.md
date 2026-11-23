---
name: design-sync
description: Keep design/otter.pen and @otter/ui (packages/ui) in sync - load the tokens into the design file after a token change, draw a new or changed component under its code name, and check the two match. Use when you change a token (tokens.css, the type or radius scale), add or change a component in packages/ui, or are asked to update the design file.
---

# Keep the design file and the code in sync

Read design/README.md first: the rules, and the map from each component in `design/otter.pen`
to its code. The code leads for tokens; components carry one name on both sides.

## After a token change

1. Change `packages/ui/src/styles/tokens.css` (or the scales in `globals.css`), then
   `pnpm design:tokens`. `pnpm test` fails until `design/tokens.json` is regenerated.
2. Load it into the file with the Pencil MCP (`execute` on `file://<repo>/design/otter.pen`) or
   `pen interactive --in design/otter.pen --out design/otter.pen`:
   `SetVariables(<design/tokens.json>, false)`. Merge, never replace: the `pen-*` variables are
   the file's own.
3. A renamed or removed token: add the new name first, move every reference (component
   properties and instance overrides, `descendants`), then drop the old one. Setting a
   reference to a variable that doesn't exist yet stores a fixed color instead. Finish with no
   `$name` in the file that isn't a variable.
4. Check with `GetVariables()`: every token in `tokens.json` is there with its light and dark
   values, and nothing else but `pen-*`.

## After a component change

Draw it in the matching frame (Primitives, Navigation & lists, Overlays…) as a reusable
component named after the code (`Button / outline`, `SidebarRow / selected`), with variants for
its props, bound to variables (`$foreground`, `$radius-lg`, `$text-body`), never fixed values.
Add its row to the map in design/README.md. Take a screenshot of the frame in light and dark.

## Always

Save the file (`save`) before committing: the file is the commit. Its text is made up (Robin
Otter at Northwind): never put real mail, names or addresses in it.
