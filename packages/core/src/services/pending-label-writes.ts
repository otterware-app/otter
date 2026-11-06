// Overlay pending local labels on server reads until writes settle; even successful writes can have older reads in flight.

import { landLabelChange, type Landing } from "@otter-mail/contracts";

import type { MessageSummary } from "../types.js";

const SETTLED_GRACE_MS = 30_000;

type PendingChange = {
  add: string[];
  remove: string[];
  landing: Landing;
  until: number;
};

/** `${accountId}:${messageId}` → changes, oldest first (so undo-after-archive
    replays in order). */
const pending = new Map<string, PendingChange[]>();

const keyOf = (accountId: string, messageId: string) => `${accountId}:${messageId}`;

function live(key: string, now = Date.now()): PendingChange[] {
  const changes = pending.get(key)?.filter((c) => c.until > now) ?? [];
  if (changes.length === 0) pending.delete(key);
  else pending.set(key, changes);
  return changes;
}

export function trackLabelWrite(
  accountId: string,
  messageIds: string[],
  add: string[],
  remove: string[],
  landing: Landing = {},
): { settled: () => void; dropped: () => void } {
  const change: PendingChange = { add, remove, landing, until: Number.POSITIVE_INFINITY };
  const keys = messageIds.map((id) => keyOf(accountId, id));
  for (const key of keys) pending.set(key, [...live(key), change]);
  return {
    settled: () => {
      change.until = Date.now() + SETTLED_GRACE_MS;
    },
    dropped: () => {
      for (const key of keys) {
        const rest = (pending.get(key) ?? []).filter((c) => c !== change);
        if (rest.length === 0) pending.delete(key);
        else pending.set(key, rest);
      }
    },
  };
}

/**
 * A label's id changed (Outlook's categories are named by their id): pending
 * changes carry the new one, so they don't bring the old one back.
 */
export function renamePendingLabel(accountId: string, from: string, to: string): void {
  const prefix = `${accountId}:`;
  const swap = (ids: string[]) => ids.map((id) => (id === from ? to : id));
  for (const [key, changes] of pending) {
    if (!key.startsWith(prefix)) continue;
    for (const change of changes) {
      change.add = swap(change.add);
      change.remove = swap(change.remove);
    }
  }
}

export function hasPendingLabelWrites(accountId: string): boolean {
  const prefix = `${accountId}:`;
  for (const key of pending.keys()) {
    if (key.startsWith(prefix) && live(key).length > 0) return true;
  }
  return false;
}

export function pendingMessageIds(accountId: string): string[] {
  const prefix = `${accountId}:`;
  return [...pending.keys()]
    .filter((key) => key.startsWith(prefix) && live(key).length > 0)
    .map((key) => key.slice(prefix.length));
}

export function withPendingLabels<T extends MessageSummary>(accountId: string, messages: T[]): T[] {
  if (pending.size === 0) return messages;
  const now = Date.now();
  return messages.map((m) => {
    const changes = live(keyOf(accountId, m.id), now);
    if (changes.length === 0) return m;
    const labels = new Set(m.labelIds);
    for (const c of changes) {
      const landed = landLabelChange([...labels], c.add, c.remove, c.landing);
      for (const l of landed.remove) labels.delete(l);
      for (const l of landed.add) labels.add(l);
    }
    const labelIds = [...labels];
    return { ...m, labelIds, unread: labels.has("UNREAD"), starred: labels.has("STARRED") };
  });
}
