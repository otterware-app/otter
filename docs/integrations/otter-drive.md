# Otter Drive feature boundary

Otter Drive (https://drive.otterware.app, Otterware's artifact host) is optional and
device-local. It does not own mailbox sync, mail storage, Otter account preferences, or relay
data. Requests start only when the user signs in, browses, or saves. Mail is sent only when the
user saves something: the chosen attachment, or the email's body as one HTML page, with the
title they give it. Everyone in the chosen Otter Drive organization can see what is saved.

## Owned modules

Otter Drive is a built-in extension: the `extensions/otter-drive` package
(`@otter-mail/extension-otter-drive`).

- `package.json`: its manifest (`otterMail`). It runs on Mac and Linux only: Drive's API sends no
  CORS headers, so the web app's backend (a Web Worker) couldn't reach it.
- `core/`: `index.ts` activates it (`otterDrive:*` handlers); `drive.ts` is the API: the device
  sign-in (the `otterware-cli` client Drive accepts for Otterware's apps), organizations,
  listing artifacts, and publishing one file as a new artifact (create, upload, complete; the
  draft is deleted if the upload fails). The token is kept in the platform's secrets.
- `ui/`: `index.tsx` is what it contributes (the "Save to Otter Drive…" message action, ⌘K's
  "Browse Otter Drive", its dialogs, its page in Settings → Connections, where it is listed as giving Files); `api.ts` sends only
  `otterDrive:*` IPC calls.

## App entry points

`apps/desktop/src/extensions.ts` (core half) and `apps/web/src/main/extensions/registry.ts` (UI
half). Nothing else in the app imports it. It adds no relay endpoints, platform methods, OAuth
secrets in the build, or iPhone code.

## Removing Otter Drive

Delete `extensions/otter-drive`, its two entries in the lists above and the two `package.json`
dependencies, its section in `docs/features.md`, and this file. Users' saved sign-ins are left in
secrets under `otter-drive`, unused.
