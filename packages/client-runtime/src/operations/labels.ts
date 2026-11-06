import { landLabelChange } from "@otter-mail/contracts";

import { ALL_MAIL_LABEL_ID } from "../label-names.ts";
import type { MailLabel, MessageSummary } from "../mail.ts";
import type { OverlayTransform } from "../state/messages.ts";

export type ModifyMessageParams = {
  accountId: string;
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

export type ModifyThreadParams = {
  accountId: string;
  threadId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

// The label-count delta math mirrors the backend's local-cache recompute in
// `mail-store.ts`'s `applyLabelChange`/`deleteMessage`, so sidebar/header
// unread badges move in lockstep with the message list instead of only
// updating once the next label sync happens.

export type LabelCountDelta = { total: number; unread: number };

export function computeLabelCountDeltas(
  priorLabelIds: string[],
  addLabelIds: string[],
  removeLabelIds: string[],
): Map<string, LabelCountDelta> {
  const priorUnread = priorLabelIds.includes("UNREAD");
  const labelSet = new Set(priorLabelIds);
  for (const lid of removeLabelIds) labelSet.delete(lid);
  for (const lid of addLabelIds) labelSet.add(lid);
  const newLabelIds = [...labelSet];
  const newUnread = newLabelIds.includes("UNREAD");

  const deltas = new Map<string, LabelCountDelta>();
  const bump = (labelId: string, total: number, unread: number) => {
    const cur = deltas.get(labelId) ?? { total: 0, unread: 0 };
    deltas.set(labelId, { total: cur.total + total, unread: cur.unread + unread });
  };

  for (const lid of addLabelIds) {
    if (!priorLabelIds.includes(lid)) bump(lid, 1, newUnread ? 1 : 0);
  }
  for (const lid of removeLabelIds) {
    if (priorLabelIds.includes(lid)) bump(lid, -1, priorUnread ? -1 : 0);
  }
  // Toggling UNREAD itself changes the unread count of every *other* label the
  // message already carries (Gmail's per-label unread counters aggregate across
  // all labels on a message), so sweep those separately from the add/remove diff.
  if (priorUnread !== newUnread) {
    const sign = newUnread ? 1 : -1;
    for (const lid of newLabelIds) {
      if (lid === "UNREAD" || addLabelIds.includes(lid) || removeLabelIds.includes(lid)) continue;
      bump(lid, 0, sign);
    }
  }
  return deltas;
}

export function applyLabelCountDeltas(
  labels: MailLabel[] | undefined,
  deltas: Map<string, LabelCountDelta>,
): MailLabel[] | undefined {
  if (!labels || deltas.size === 0) return labels;
  return labels.map((l) => {
    const delta = deltas.get(l.id);
    if (!delta) return l;
    return {
      ...l,
      total: Math.max(0, (l.total ?? 0) + delta.total),
      unread: Math.max(0, (l.unread ?? 0) + delta.unread),
    };
  });
}

/**
 * Optimistically applies a label change to a row. `scope` says what changed:
 * a whole thread (its label union changes the same way) or one message (an
 * added label joins the thread's union; a removed one may still be on sibling
 * messages, so the union keeps it until the server refresh).
 */
export function applyLabelPatch<T extends MessageSummary>(
  m: T,
  addLabelIds: string[],
  removeLabelIds: string[],
  scope: "thread" | "message" = "message",
  archiveFolder?: boolean,
): T {
  const patch = (ids: string[], removals: string[], thread = false) => {
    const landed = landLabelChange(ids, addLabelIds, removals, { archiveFolder, thread });
    const set = new Set(ids);
    for (const lid of landed.remove) set.delete(lid);
    for (const lid of landed.add) set.add(lid);
    return [...set];
  };
  const labelIds = patch(m.labelIds, removeLabelIds, scope === "thread");
  const unread = labelIds.includes("UNREAD");
  const starred = labelIds.includes("STARRED");
  return {
    ...m,
    labelIds,
    unread,
    starred,
    threadUnread: m.threadUnread === undefined ? undefined : unread,
    threadStarred: m.threadStarred === undefined ? undefined : starred,
    threadLabelIds:
      m.threadLabelIds === undefined
        ? undefined
        : scope === "thread"
          ? patch(m.threadLabelIds, removeLabelIds)
          : [...new Set([...m.threadLabelIds, ...labelIds])],
  };
}

export const inThread =
  (accountId: string, threadId: string) =>
  (m: MessageSummary): boolean =>
    (m.threadId || m.id) === threadId && (m.accountId ?? accountId) === accountId;

/**
 * A thread's label change, on its rows. Thread-scoped removals also take it
 * off the lists it no longer matches, so archive, move and junk clear the
 * view at once as trash does. All Mail only loses what goes to spam or trash.
 */
export function threadChange(
  params: ModifyThreadParams,
  archiveFolder?: boolean,
): OverlayTransform {
  const { accountId, threadId, addLabelIds = [], removeLabelIds = [] } = params;
  const match = inThread(accountId, threadId);
  const leavesAllMail = addLabelIds.includes("SPAM") || addLabelIds.includes("TRASH");
  const leaves = landLabelChange([], addLabelIds, removeLabelIds, { archiveFolder }).remove;
  return (row, { labelId }) => {
    if (!match(row)) return row;
    if (labelId && (leaves.includes(labelId) || (leavesAllMail && labelId === ALL_MAIL_LABEL_ID)))
      return null;
    return applyLabelPatch(row, addLabelIds, removeLabelIds, "thread", archiveFolder);
  };
}

/** One message's label change: the thread's union keeps a removed label until core says otherwise. */
export function messageChange(
  params: ModifyMessageParams,
  archiveFolder?: boolean,
): OverlayTransform {
  const { messageId, addLabelIds = [], removeLabelIds = [] } = params;
  return (row) =>
    row.id === messageId
      ? applyLabelPatch(row, addLabelIds, removeLabelIds, "message", archiveFolder)
      : row;
}

/** Rows that leave every list: trashed, or deleted forever. */
export const without =
  (match: (row: MessageSummary) => boolean): OverlayTransform =>
  (row) =>
    match(row) ? null : row;
