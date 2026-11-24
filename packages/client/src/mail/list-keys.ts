export function withOccurrenceKeys<T>(items: T[], keyOf: (item: T) => string) {
  const counts = new Map<string, number>();
  return items.map((item, index) => {
    const value = keyOf(item);
    const occurrence = counts.get(value) ?? 0;
    counts.set(value, occurrence + 1);
    return { item, index, key: `${value}:${occurrence}` };
  });
}

/**
 * One row per conversation across a list's pages. The pages are offsets into a list that can
 * change between fetches (a mailbox filling, new mail), so a conversation near a page's edge can
 * come back on two; the first, newer one wins.
 */
export function onePerConversation<T extends { accountId?: string; threadId: string; id: string }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.accountId ?? ""}:${row.threadId || row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
