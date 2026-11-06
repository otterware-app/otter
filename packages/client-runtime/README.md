# Client Runtime

What every Otter Mail client does the same, for the web app now and the phone next. Public
APIs are package subpaths; there is no root export. Nothing here touches React, the DOM or
`window`: a client gives it a `ClientPlatform` (storage, focus, ids) and a `CoreBridge` (invoke,
broadcasts), and reads its atoms with `@effect/atom-react`.

| Subpath                                                        | What it holds                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `platform`                                                     | `ClientPlatform`, `KeyValueStorage`, `AppFocus` and their Context services         |
| `rpc`                                                          | `makeCoreClient(port)`: the RpcClient of core's protocol (`CoreHostRpcs`)          |
| `connection`                                                   | `CoreConnection` (Effect service), `connectCore` (promises, restart), `CoreBridge` |
| `state/chats`                                                  | `makeChatsStore`: the agent's chats, their runs, queue and continuations           |
| `state/messages`                                               | `makeThreadLists`: a mailbox's lists, paged, with optimistic overlays              |
| `state/mailboxes`                                              | `makeMailboxes`: the mailboxes and their labels                                    |
| `operations`                                                   | `makeMailOperations` (archive, trash, label, undo), undo history, undo-send        |
| `mail`                                                         | The mail shapes core answers with (`MessageSummary`, `MailLabel`, …)               |
| `label-tree`, `label-names`, `address`, `text`, `capabilities` | Pure helpers                                                                       |

State modules take the app's `AtomRegistry`: the web app's is `apps/web/src/main/atom-registry.ts`.
