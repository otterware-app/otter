import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";

import { core } from "./core";

export type MessageDetail = MessageSummary & {
  bodyText?: string | null;
  bodyHtml?: string | null;
  bcc?: string;
  attachments?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    contentId?: string;
  }[];
};

export const threadKey = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;

/** A conversation's messages from the cache (sender, date, snippet): the reader shows them at once. */
export const threadAtom = Atom.family((key: string) => {
  const [accountId, threadId] = key.split("\u0000") as [string, string];
  return Atom.make(
    Effect.promise(() => core.invoke<MessageSummary[]>("gmail:getThread", { accountId, threadId })),
  );
});

export const messageKey = (accountId: string, messageId: string) =>
  `${accountId}\u0000${messageId}`;

/**
 * One message whole, body included, as its row in the reader asks for it: from
 * the cache, else from the server ahead of sync (core marks it urgent). Null
 * when it's gone from the server.
 */
export const messageAtom = Atom.family((key: string) => {
  const [accountId, messageId] = key.split("\u0000") as [string, string];
  return Atom.make(
    Effect.tryPromise(() =>
      core.invoke<MessageDetail | null>("gmail:getMessage", { accountId, messageId }),
    ),
  );
});

/** A gate probe, run where core runs (`gate:probe`). */
export const probe = (name: string, args?: unknown) => core.invoke("gate:probe", { name, args });
