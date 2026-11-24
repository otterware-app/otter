# IMAP mailboxes

Otter reads Gmail through the Gmail API, and every other mailbox through IMAP (sending over
SMTP). The Otter account itself stays a Google sign-in (better-auth). This is how the
providers sit side by side; Outlook, the third, is in [outlook.md](outlook.md).

## Layers

```
renderer (apps/web)         labels, threads, capabilities — never the provider itself
  │ gmail:* channels (names unchanged)
core handlers               providerFor(account).…
  │
MailProvider                packages/core/src/providers/provider.ts
  ├─ gmail/                 Gmail API, quota, history sync, users.watch → relay push
  └─ imap/                  folders ↔ labels, flags, UID/modseq sync, IDLE
        │
      protocols             packages/core/src/protocols/{imap,smtp}: plain TypeScript clients
        │                   over a ByteStream (no Node APIs: they run in the browser too)
      platform.connect()    desktop: node:tls sockets
                            web: WebSocket to the relay's /v1/tunnel, TLS done in the worker
```

- `contracts/src/mail.ts` has the shared model: `MailProviderKind`, `ImapSettings`,
  `MailCapabilities` (and each provider's). The UI gates on capabilities, the way it gates
  Mac-only UI on `features`.
- An account is `MailAccount` with `provider` (absent = Gmail) and `imap` settings. Its id is
  its address for both providers.
- The IMAP password lives in `platform.secrets` under `imap-password:<accountId>`
  (`services/imap-passwords.ts`); it is never synced. A mailbox linked on another device arrives
  with its settings and shows as signed out until the password is entered (`gmail:signInImap`).
  A password the server refuses is set aside (signed out, no retries) until it's entered again;
  so is one whose mailbox the relay lists with other hosts (the device keeps its own settings).
- Adding one (`handlers/imap-accounts.ts`): `gmail:discoverImap` finds the servers (known
  providers, Mozilla's ISPDB, the domain's autoconfig file on the Mac only, as its host rarely
  allows CORS, then the MX records over DNS-over-HTTPS); `gmail:addImapAccount` logs in to both
  servers before saving anything.

- Other addresses a mailbox sends from (iCloud+ custom domains, aliases) are `sendAs` on the
  account (`capabilities.sendAs = "device"`): entered in Settings, synced by address like
  signatures. Sending uses one as the From header and the SMTP envelope sender
  (`senderOf`, `services/outgoing.ts`); the server must accept it. Gmail's come from its
  "Send mail as" settings (`"server"`).
  Settings suggests ones the mailbox's mail shows it uses (`gmail:suggestSendAs`,
  `services/send-as-suggestions.ts`): any its Sent mail is from, and any at a domain of its own
  (not a public one like icloud.com) that inbox mail came to more than once.
- iCloud has its own choice in Add account: the same IMAP mailbox, with iCloud's servers and the
  steps to make an app-specific password. Apple has no mail API or OAuth for other apps.

## Live mail

- Gmail, unchanged: `users.watch` → Pub/Sub → relay `/push/gmail` → the user's Durable Object →
  `/v1/events` WebSocket → `syncAccount(…, { trigger: "push" })`.
- IMAP: each device keeps one IDLE connection per mailbox (on INBOX) and calls the same
  `syncAccount(…, { trigger: "push" })` when the server reports EXISTS/EXPUNGE/FETCH. Re-IDLE
  every 25 minutes; reconnect with backoff; `onResume` restarts it. Servers without IDLE fall
  back to the sync timer.
- Both are `provider.watch(account, onChange)`; the sync engine doesn't know which fired.

## IMAP on the Gmail-shaped cache

- Folders are labels. Special-use folders map to system label ids: INBOX → `INBOX`, `\Sent` →
  `SENT`, `\Drafts` → `DRAFT`, `\Trash` → `TRASH`, `\Junk` → `SPAM`, `\Archive` → `ARCHIVE`
  (shown as Archive in the sidebar, in place of All Mail: `capabilities.archiveFolder`). Servers
  that don't flag them get them by name (Archive, Archives, …). Other folders are user labels
  whose id is the folder path and whose name uses `/` as the separator. `\All` and `\Flagged`
  folders hold copies of other folders' mail and aren't synced.
- Flags: no `\Seen` → `UNREAD`, `\Flagged` → `STARRED`.
- A message sits in one folder (`capabilities.multipleLabels = false`): applying a label moves
  it (UID MOVE, or COPY + `\Deleted` + UID EXPUNGE), archive (taking INBOX or a folder away)
  moves to the Archive folder, made (flagged `\Archive` where the server has CREATE-SPECIAL-USE)
  when there's none, and trash moves to Trash. Taking ARCHIVE away puts mail back in the inbox.
  Archived mail lands in ARCHIVE in the cache at once (contracts' `landLabelChange`). The app's
  Archive archives from any of your folders, as Apple Mail's does: in a folder's list it takes
  that folder away (`packages/client/src/mail/archive.ts`).
- Gmail's IMAP (X-GM-EXT-1) archives into `[Gmail]/All Mail` (`\All`), which only takes the
  message out of the inbox; a folder named Archive there is just a label. Moving mail back out
  of All Mail is a COPY (taking it out of All Mail would delete it). Of All Mail, only archived
  mail is synced (Gmail's own search, `X-GM-RAW "-in:inbox -in:sent -in:drafts -in:chats
has:nouserlabels"`), so nothing is cached twice; `[Gmail]/Important` (`\Important`) isn't
  synced for the same reason. To the app such a mailbox is Gmail (core's `capabilitiesOf`, by
  its server): All Mail rather than an Archive folder, and Starred.
- Message ids: `<uidvalidity>:<uid>:<folder path>`, re-keyed in the cache when the message
  moves (COPYUID tells the new uid, else the next sync finds it by Message-ID).
- Threads: the root Message-ID of `References` (else `In-Reply-To`, else its own Message-ID),
  and the subject without Re:/Fwd: (References is the sender's to write), so a reply in Sent
  and its original in INBOX share a thread. Junk / Not junk on a thread moves only what's in
  the folder it was reported from.
- Sync, per folder: `UIDVALIDITY` change → refetch the folder; otherwise new UIDs since the
  stored `UIDNEXT`, and flag changes since the stored `HIGHESTMODSEQ` (CONDSTORE/QRESYNC),
  or a full UID + FLAGS listing on servers without it (which also finds expunged mail).
  Summaries come from ENVELOPE (Cc included), FLAGS, BODYSTRUCTURE, the reply headers and the
  delivery headers (alias mailboxes, below); bodies are
  fetched on open (`BODY.PEEK[]`, parsed with postal-mime).
- Folder counts: the cache's, once the folder is all cached, so a badge agrees with its list;
  STATUS (`UNSEEN`, `MESSAGES`) while it's still filling. STATUS counts mail marked `\Deleted`,
  which isn't cached.
- Sending: SMTP, then APPEND to Sent unless the server files sent mail itself. Drafts: APPEND
  to Drafts, deleting the previous version.
- Search runs on the local cache (FTS); signatures are stored on the device (synced as a
  preference); invitations are answered by email reply.

## Alias mailboxes

One of the addresses a mailbox sends from (`sendAs`) can have a mailbox of its own: the
**Own mailbox** switch on its row in Settings › Connections › Send from. A custom domain's
addresses delivered into one iCloud inbox then each get a tab beside the mailboxes, with their
own Inbox, Flagged, Sent, Drafts, Archive, Junk and Trash, filtered from the parent's mail, and
their own name, color and signature. The parent's tab shows their mail too, unless its **Their
mail in … too** switch (under the Send from addresses) is off. IMAP only for now
(`capabilities.sendAs === "device"`).

- Data: `account.aliasMailboxes` (contracts' `AliasMailbox`: address, name, color, signature),
  synced as the `aliasMailboxes` preference, `{ [parent address, lower-cased]: AliasMailbox[] }`,
  like `sendAs` (`services/preferences.ts`). Each address must be one the parent sends from and
  not a mailbox added of its own (`services/alias-mailboxes.ts`, `saveAliasMailboxes` in
  `services/signatures.ts`); taking an address out of Send from takes its mailbox away. Its id
  (route, `mail:mailboxes`, a notification's `open.mailbox`) is its address lower-cased. Its
  default name is the address's local part, capitalized (me@ → "Me"); its default color comes
  from the id, as an account's does. A picture chosen for it is the parent's `aliasPictures[id]`,
  kept with the parent's row on the relay (`alias_pictures`, at most 16) like a mailbox's own
  picture, not in the capped preferences; it stays while its mailbox is off.
- Order and on/off: the `mail:mailboxes` UI preference, keyed by its id. Its tab drags anywhere
  in the sidebar's row (`arrangeMailboxes` and `moveMailbox`, `apps/web/src/main/mailboxes.ts`);
  one not dragged yet follows its parent and the parent's others. Settings › Connections lists it
  under its parent either way. Turned off, or with its parent off, it isn't shown.
- The parent without their mail: the `mail:alias-mail-apart` UI preference lists the parents
  (addresses, lower-cased) whose switch is off, and core follows it (`followAliasMailApart`). Their
  tab then lists what none of their alias mailboxes that are turned on has (`RestScope`,
  `services/mail-store.ts`; a turned-off one's mail stays, or it would be nowhere), and its folder
  counts are the folder's less theirs (`withoutAliasMail`), since a folder still filling counts
  mail not cached yet. Searching the parent still finds all of its mail.
- Which mail is its own (`aliasWhere`, `services/mail-store.ts`). Each copy keeps every
  address it was delivered to: the topmost `Original-Recipient` (`rfc822;` stripped; iCloud
  stamps it on every delivered copy), `Delivered-To` and `X-Original-To` (Postfix with virtual
  aliases: the mailbox's own address, and the alias it came to), lower-cased, in
  `messages.deliveredTo` (`deliveryAddressesOf`, `providers/imap/messages.ts`). The To and Cc
  addresses are kept in `messages.recipients`. Both are `<a@x><b@y>`, so an address matches
  exactly (`xme@` isn't `me@`). Inbox and Junk: a copy delivered to any of the parent's other
  addresses (its Send from list) is for the alias mailboxes named there only; one delivered to
  none of them (to the mailbox's own address, or naming none) goes by To and Cc, so mail to the
  mailbox's own address is no alias's. Sent and Drafts: it's the From. Archive, Trash and
  Flagged: either. Its folder counts come from the same rule (`gmail:listLabels` with `alias`);
  the tab's dot is its Inbox's unread.
- Copies: a message sent to one address and Bcc'd to another arrives twice in the same folder,
  with one Message-ID, differing only in `Original-Recipient`. Each alias mailbox shows its own
  copy; anywhere both are listed (the parent), the conversation counts and shows the message once
  (`getThreadForReading`), and reading, flagging or trashing it changes every copy (`getCopies`).
- Mail cached before the delivery headers were fetched is read once in the backfill lane: just
  those headers, by UID, a page at a time (`backfillDeliveredTo`, `providers/imap/sync.ts`).
- Actions act on the parent's mail (routes are `/<alias>/<label>[/<message>?account=<parent>]`).
  Search started in an alias mailbox searches its mail. New mail written there starts From its
  address, and replies there go from it; elsewhere a reply goes from whichever address the mail
  was sent to. The signature follows From: the alias mailbox's own, else the parent's.
- Notifications are named after the first alias mailbox in To, then Cc, then the addresses it
  was delivered to, and open in it; copies notify once (by Message-ID, for a quarter of an hour), and the
  badge counts them once (`services/notifier.ts`).

## The web app's tunnel

The browser can't open TCP connections, so the relay forwards bytes: `GET /v1/tunnel?host=…&port=…`
upgrades to a WebSocket (Otter session required), the relay opens the TCP connection with
`cloudflare:sockets` (TLS off) and pipes binary frames both ways; either side closing closes
both. The worker negotiates TLS inside the tunnel itself, so the relay carries only ciphertext
(for STARTTLS, just the plaintext greeting before the upgrade). Only mail ports (143, 993,
465, 587) are allowed. Nothing is logged but host, port and byte counts. The servers of the
account's linked IMAP mailboxes get full tunnels; any other host (checking a password before
the mailbox is linked) gets 6 a minute of 1 MB each, so a mailbox must be linked before it
syncs. The limits are in infra/relay/README.md.

## The iPhone app

Its own Swift implementation of the same design: a `MailProvider` protocol with the existing
Gmail client and an IMAP one (Network.framework, TLS by the system), IDLE while the app is in
the foreground, and the same folder ↔ label mapping, so its lists and drawer work unchanged.

## Outlook

A Microsoft Graph provider next to `gmail/` and `imap/`, with Microsoft's OAuth sign-in: see
[outlook.md](outlook.md).
