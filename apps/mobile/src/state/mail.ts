import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

import { CoreHost, layerWorklets } from "./core";

export type MailAccount = {
  id: string;
  email: string;
  name?: string;
  displayName?: string;
  color?: string;
};

export type ThreadRow = {
  id: string;
  accountId?: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  threadCount?: number;
  threadUnread?: boolean;
};

export type MessageDetail = ThreadRow & {
  bodyText?: string | null;
  bodyHtml?: string | null;
  to?: string;
};

export const coreRuntime = Atom.runtime(layerWorklets);

export const coreReadyAtom = coreRuntime.atom(
  Effect.flatMap(Effect.service(CoreHost), (core) => core.ready),
);

export const probeAtom = coreRuntime.fn((request: { name: string; args?: unknown }) =>
  Effect.flatMap(Effect.service(CoreHost), (core) => core.probe(request.name, request.args)),
);

export const accountsAtom = coreRuntime.atom(
  Effect.gen(function* () {
    const core = yield* CoreHost;
    yield* core.ready;
    return yield* core.invoke<MailAccount[]>("gmail:listAccounts");
  }),
);

/** Bumps whenever core says mail changed, so lists read the cache again. */
export const mailChangesAtom = coreRuntime.atom(
  Stream.unwrap(
    Effect.map(Effect.service(CoreHost), (core) =>
      core.events("gmail:").pipe(
        Stream.scan(
          () => 0,
          (count: number) => count + 1,
        ),
      ),
    ),
  ),
  { initialValue: 0 },
);

const PAGE = 5000;

export const inboxAtom = Atom.family((accountId: string) =>
  coreRuntime.atom((get) =>
    Effect.gen(function* () {
      get(mailChangesAtom);
      const core = yield* CoreHost;
      const page = yield* core.invoke<{ messages: ThreadRow[] }>("gmail:listMessages", {
        accountId,
        labelIds: ["INBOX"],
        maxResults: PAGE,
      });
      return page.messages;
    }),
  ),
);

export const threadAtom = Atom.family((key: string) =>
  coreRuntime.atom(
    Effect.gen(function* () {
      const [accountId, threadId] = key.split("\u0000") as [string, string];
      const core = yield* CoreHost;
      const messages = yield* core.invoke<ThreadRow[]>("gmail:getThread", { accountId, threadId });
      return yield* Effect.forEach(
        messages,
        (message) =>
          core
            .invoke<MessageDetail>("gmail:getMessage", { accountId, messageId: message.id })
            .pipe(Effect.orElseSucceed(() => message as MessageDetail)),
        { concurrency: 4 },
      );
    }),
  ),
);

export const threadKey = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;
