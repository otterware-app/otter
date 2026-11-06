import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import { core } from "./core";

export type MessageDetail = MessageSummary & {
  bodyText?: string | null;
  bodyHtml?: string | null;
  attachments?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId?: string;
  }[];
};

export const threadKey = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;

/** A conversation as the reader shows it: its messages, each with its body (fetched on open). */
export const threadAtom = Atom.family((key: string) => {
  const [accountId, threadId] = key.split("\u0000") as [string, string];
  return Atom.make(
    Effect.gen(function* () {
      const messages = yield* Effect.promise(() =>
        core.invoke<MessageSummary[]>("gmail:getThread", { accountId, threadId }),
      );
      return yield* Effect.forEach(
        messages,
        (message) =>
          Effect.promise(() =>
            core
              .invoke<MessageDetail>("gmail:getMessage", { accountId, messageId: message.id })
              .catch(() => message as MessageDetail),
          ),
        { concurrency: 4 },
      );
    }),
  );
});

/** A gate probe, run where core runs (`gate:probe`). */
export const probe = (name: string, args?: unknown) => core.invoke("gate:probe", { name, args });
