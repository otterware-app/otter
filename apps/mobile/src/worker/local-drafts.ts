import type { ComposeAttachment } from "@otter-mail/core";

import type { SwiftRecoveredDraft } from "./recovered-drafts";

/**
 * "On this iPhone" (the Swift app's recoveries, in Drafts): messages kept on the
 * phone rather than saved to the mailbox's drafts. Two kinds: the composer's
 * "Keep on This iPhone" copies, and the Swift app's recovery copies its importer
 * hasn't made drafts of (one that failed to save). An imported copy is a
 * draft in the mailbox now and done, so neither is listed twice.
 */

export type LocalCopy = {
  id: string;
  accountId: string;
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string;
  attachments?: ComposeAttachment[];
  /** ms since 1970. */
  updated: number;
};

/** What the list shows of one. */
export type LocalCopySummary = {
  id: string;
  subject: string;
  to: string;
  from: string;
  updated: number;
  /** the Swift app's, not imported yet. */
  legacy: boolean;
};

/** Foundation's reference date, which the Swift app's `updated` counts from, in ms since 1970. */
const REFERENCE_DATE_MS = 978_307_200_000;

export function localCopySummaries(
  accountId: string,
  email: string,
  copies: readonly LocalCopy[],
  legacy: readonly SwiftRecoveredDraft[],
  done: ReadonlySet<string>,
): LocalCopySummary[] {
  const own = copies
    .filter((c) => c.accountId === accountId)
    .map((c) => ({
      id: c.id,
      subject: c.subject,
      to: c.to,
      from: c.from ?? email,
      updated: c.updated,
      legacy: false,
    }));
  const ids = new Set(own.map((c) => c.id));
  const theirs = legacy
    .filter(
      ({ draft }) =>
        draft.from.toLowerCase() === email.toLowerCase() &&
        !done.has(draft.id) &&
        !ids.has(draft.id),
    )
    .map(({ draft, updated }) => ({
      id: draft.id,
      subject: draft.subject,
      to: draft.to,
      from: draft.address ?? draft.from,
      updated: updated * 1000 + REFERENCE_DATE_MS,
      legacy: true,
    }));
  return [...own, ...theirs].sort((a, b) => b.updated - a.updated);
}

export function keepCopy(copies: readonly LocalCopy[], copy: LocalCopy): LocalCopy[] {
  return [copy, ...copies.filter((c) => c.id !== copy.id)];
}
