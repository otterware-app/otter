# Third-party notices

Otter is MIT licensed ([LICENSE](LICENSE)). It includes, or is derived from, the work below.
The packages it depends on, each with its license, are listed in the app: Settings → General →
Open-source licenses ([how the list is made](docs/development.md#open-source-licenses)).

## T3 Code

https://github.com/pingdotgg/t3code, MIT, by T3 Tools Inc. and its contributors.

Otter's agents are modelled on T3 Code: how chats are listed, queued, steered and searched, the
phone app's layout, the data home, the release trains. Most of that is our own code written
after theirs. These files are ported or adapted from T3 Code's source:

- The color themes and their editor: `packages/shared/src/theme-palettes.ts`,
  `apps/web/src/main/theme/themePalette.ts`, `vscodeThemeImport.ts` and their tests,
  `apps/web/src/main/settings/theme/` (`ThemeEditorHost.tsx`, `ThemeEditorPanel.tsx`,
  `ThemeImportDialog.tsx`, `ThemeColorPicker.tsx`, `themeEditorStore.ts`, `themeInspector.ts`)
- UI primitives in `apps/web/src/components/ui/`: `alert.tsx`, `color-picker.tsx`,
  `popover.tsx`, `toggle.tsx`, `toggle-group.tsx`, `tooltip.tsx` (after shadcn/ui and coss ui,
  below)
- Toasts: `apps/web/src/main/mail/toast.tsx`, `toast-layout.ts`
- Panel animations: `apps/web/src/main/panel-animations.ts`,
  `apps/web/src/main/settings/panel-animations-preview.tsx`
- The list of open-source licenses: `scripts/lib/third-party-licenses.ts` and its test,
  `scripts/sync-third-party-license-notices.ts`, `packages/shared/src/third-party-licenses.ts`
- Parts of `apps/web/src/styles.css` (contrast, borders, the top bar's fade, the shine on running
  work) and of `apps/web/src/main/agent/chat-queue.tsx`

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## shadcn/ui and coss ui

https://ui.shadcn.com (MIT, Copyright (c) 2023 shadcn) and https://coss.com/ui. The primitives
in `apps/web/src/components/ui/` follow their components, on Base UI.

## PDF.js

https://github.com/mozilla/pdf.js, Apache-2.0, Copyright Mozilla and individual contributors.
`apps/web/src/main/mail/pdf-viewer.css` is the text layer of `pdfjs-dist/web/pdf_viewer.css`,
modified.

## A sea otter shows its grizzle

https://www.usgs.gov/media/images/a-sea-otter-shows-its-grizzle, by Joseph Tomoleoni, Western
Ecological Research Center, U.S. Geological Survey. Public domain. The picture behind a new chat
(`apps/web/src/main/assets/agent-otter.jpg`, resized).

## Inter

https://github.com/rsms/inter, SIL Open Font License 1.1, Copyright (c) 2016 The Inter Project
Authors. Bundled in the web and desktop app (`@fontsource-variable/inter`) and the iPhone apps
(`apps/ios/OtterMail/Resources/Fonts/`, with its license).

## Names and marks

Gmail, Google Calendar and Google Meet are trademarks of Google LLC; Outlook, Microsoft Teams
and Microsoft 365 of Microsoft; Claude and Claude Code of Anthropic; Codex and OpenAI of
OpenAI; Todoist of Doist; Zoom of Zoom Communications; Webex of Cisco; T3 Code and T3 Chat of
T3 Tools Inc.; VS Code of Microsoft; OpenClaw and Hermes of their makers. Their names and
marks say which service or agent Otter connects to, or which app a color theme comes from.
Otter is not affiliated with, endorsed by or sponsored by any of them.
