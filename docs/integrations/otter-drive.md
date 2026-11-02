# Otter Drive feature boundary

Otter Drive (https://drive.otterware.app, Otterware's documents) is optional and device-local. It
does not own mailbox sync, mail storage, Otter account preferences, or relay data. Requests start
only when the user opens Drive, signs in, or saves. Mail leaves the device only when the user saves
something: the chosen attachment, or the email's body as one HTML page, into the drive they pick.
Everyone with access to that drive can see it.

## Owned modules

Otter Drive is a built-in extension: the `extensions/otter-drive` package
(`@otter-mail/extension-otter-drive`).

- `package.json`: its manifest (`otterMail`): a connection, the `drive` workspace
  (`contributes.workspaces`), Mac and Linux only until Drive's API answers the web app (CORS, the
  otter-drive branch `otter-mail-cors`).
- `core/`: `index.ts` registers the `otterDrive:*` handlers; `drive.ts` is the API: the device
  sign-in (the `otterware-cli` client Drive accepts for Otterware's apps), drives and folders
  (`/api/v1/folders`), Shared with me (`/api/v1/shared`), a folder's documents (the
  `x-otterdrive-folder` header), versions, previews, rename, archive, thumbnails (Drive serves them
  same-site only, so cards fall back to the backend), and publishing one file as a new document
  (create, upload, complete; the draft is deleted if the upload fails). The token and the drives
  turned off (`hidden`) are kept in the platform's secrets; every document call goes through
  `reachable`, which refuses a drive that's off.
- `ui/`: `index.tsx` is what it contributes: the workspace (`workspace.tsx`: the sidebar's drive
  picker, filters and list, and the overview grid; `document.tsx`: the open document), "Save to
  Otter Drive…" on messages (`dialogs.tsx`), its page in Settings → Connections with a switch per
  drive (`settings.tsx`), the Drive marks (`glyph.tsx` from the Otterware production kit,
  `drive-mark.tsx` as Otter Drive draws drives). `api.ts` sends only `otterDrive:*` IPC calls.

Previews never use Drive's own preview links: those hang on a same-site cookie a frame in the
desktop app never gets. One-file pages are fetched with the token and shown in a `srcdoc` frame
sandboxed without same-origin.

## App entry points

`apps/desktop/src/extensions.ts` (core half) and `apps/web/src/main/extensions/registry.ts` (UI
half). Nothing else in the app imports it; its workspace reaches the app only through the
`workspaces` slot. It adds no relay endpoints, platform methods, OAuth secrets in the build, or
iPhone code.

## Removing Otter Drive

Delete `extensions/otter-drive`, its two entries in the lists above and the two `package.json`
dependencies, its section in `docs/features.md`, and this file. Users' saved sign-ins are left in
secrets under `otter-drive`, unused.
