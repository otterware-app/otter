# Connections

Status: agreed direction (reviewed by Codex and Muse Wonder, 2026-11-02); built in steps.

## Why

Today one type, `MailAccount`, means two things: a sign-in to an outside service (Google,
Microsoft, an IMAP server) and the mailbox it gives. Everything else hangs off the mailbox:

- the calendar is `provider.calendar` of a mail account: no calendar without a mailbox;
- Todoist keeps its own token per device, outside the Otter account;
- what a sign-in was granted isn't known to core. A permission added later (#188's
  `calendar.readonly`, earlier `gmail.settings.basic`) surfaced as a vague "sign in again" per
  feature, often with nowhere to do it;
- agents have no single picture of what the user has connected.

## Words

- **Otterware account**: who you are (better-auth on the relay). The root; holds the rest.
- **Connection**: one sign-in to an outside service, on your behalf: Google you@gmail.com,
  Microsoft, an IMAP server (iCloud), later Todoist, Notion, Drive.
- **Resource**: what a connection provides, by kind: `mail` (a mailbox), `calendar` (the
  service's calendars, not one calendar), `contacts`, later `tasks`, `docs`, `files`. A resource
  carries the capability flags of what it comes from: an IMAP connection has no calendar, so it
  never shows one, or asks permission for one.
- **Address**: one of a mailbox's From addresses (its own, `sendAs`).
- **Integration** (Settings copy): a feature that isn't a connection (Translation, Sign-in codes).
  Agents stay their own category.

## Decisions

- **Derived, never migrated.** Built-in connections are computed from `accounts.json` and the
  live sign-ins. No stored or synced shape changes: not `accounts.json`, not the relay's
  `linked_accounts`, not preferences. What needs permission is computed, never persisted.
- **Ids.** A built-in connection's id is its mailbox's id, the bare address, as every stored key
  is (accounts, the relay's `(userId, email)` key, preferences by address). The same address on
  Google and on IMAP at once stays unsupported. Namespaced ids (`todoist:<user id>`) are for
  extension connections, later.
- **Permission state is per operation, and honest about what's unknown.** Calendar "list every
  calendar" (`calendar.readonly`) and "answer invitations" (`calendar.events.owned` or the older
  `calendar.events`) are separate. Without recorded grants, a need is inferred from the provider
  refusing that operation, held in memory, and cleared when the connection signs in again.
  `NoCalendarAccess` also covers disabled APIs, so the copy says what's missing ("Only your main
  calendar is showing"), not why.
- **Allow = sign in again for that address**, with the provider's full scope list (today's
  working flow), never a narrower incremental grant that could drop mail access. It keeps the
  mailbox's settings (fixed in #193) and says so when another account was chosen at Google.
- **Copy names the consequence, not the scope**: "Only your main calendar is showing · Allow
  calendar access", never `calendar.readonly`.
- **No manifest `contributes.connections`**: extensions activate eagerly; Settings asks core.
- **Todoist stays device-local** until connections have ownership (which Otter account), "remove
  here" vs "remove everywhere", and per-key merging in preferences (sections are written whole;
  the iPhone writes back what it pulled). Its secrets carry no user id today.

## Steps

0. **#193**: an Allow button on the calendar's notice; re-sign-in keeps mailbox settings.
1. **Connections view** (done):
   - contracts: `ConnectionSummary`, `ConnectionResource`, `AccessNeed`, `ResourceKind`;
   - core `services/connections.ts`: `listConnections()` derived from accounts and providers'
     capabilities; access needs inferred per operation (calendar list from `NoCalendarAccess`,
     Gmail signature saving from `signatureInGmail === false`), in memory, cleared on sign-in;
     channel `connections:list`, broadcast `connections:changed`;
   - renderer: one `useAllowAccess` flow; the calendar notice and Settings use it. Each
     mailbox's Settings page shows what its connection provides and what needs permission, with
     the Allow button; the mailbox list marks "Needs permission";
   - agent: `list_mailboxes` reports what needs permission, so the agent can say "allow calendar
     access" rather than fail.
2. **Grants**: a Platform accessor for a sign-in's granted scopes. Desktop Google already stores
   them (`StoredTokens.scope`) but must keep them when a refresh omits `scope`; web needs the
   relay to pass `scope` through `GoogleSignInResult` and its sealed record; Microsoft's stored
   tokens need a `scope` field. Where grants are known, needs come from them (and "unknown" stays
   distinct from "missing").
3. **Connections hub** (done): Settings › Mailboxes is now Connections: each mailbox says what it
   provides (Mail · Calendar), Add account offers every kind (Google, Microsoft, IMAP, then other
   services), and an extension of category `connection` (Todoist) is listed there with its page,
   through a renderer contribution (`connection: { provides, status }`). Core is unchanged.
4. **Extension connections in core**: `registerConnectionProvider` with per-instance operations, Todoist
   onto it with a `tasks` resource and agent tools; per-resource toggles (use this account's
   calendar or not). Sync only once ownership and per-key merging exist.
5. Later: calendars not tied to a mailbox (iCloud CalDAV), Drive and Notion, per-connection agent
   permissions, the iPhone app.
