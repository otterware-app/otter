import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { attachmentFiles, ATTACHMENT_DIR } from "./attachment-cache.js";
import { cacheWindow, windowStart } from "./coverage.js";
import { listSchedules } from "./mail-schedule.js";
import * as store from "./mail-store.js";
import { pendingMessageIds } from "./pending-label-writes.js";

const opened = new Map<string, string>();

/** The thread being read: it stays whole, and its messages count as just read. */
export function noteOpened(accountId: string, threadId: string, messageIds: string[] = []): void {
  if (!cacheWindow()) return;
  opened.set(accountId, threadId);
  store.markRead(accountId, messageIds);
}

export function forgetOpened(accountId: string): void {
  opened.delete(accountId);
}

/** Threads that are never evicted besides those with a draft or a star (the store's own rule). */
function keptThreads(accountId: string): Set<string> {
  const kept = new Set(store.threadIdsOf(accountId, pendingMessageIds(accountId)));
  const open = opened.get(accountId);
  if (open) kept.add(open);
  for (const entry of listSchedules()) {
    if (entry.accountId === accountId && entry.threadId) kept.add(entry.threadId);
  }
  return kept;
}

/**
 * A mailbox's conversations older than its window leave the cache, past the
 * newest `minThreads`; answers whether any did. Lists page them in from the
 * server again (live paging), as they would have before the first sync.
 */
export function evictBeyondWindow(accountId: string): boolean {
  const window = cacheWindow();
  if (!window) return false;
  const gone = store.evictThreads(
    accountId,
    windowStart(window),
    window.minThreads,
    keptThreads(accountId),
  );
  if (gone.length > 0) logger.info("retention", `evicted ${gone.length} threads of ${accountId}`);
  return gone.length > 0;
}

/**
 * Keeps downloaded bodies and attachment files together under
 * `retentionBytes`, the least recently read going first. Never a draft's, a
 * starred conversation's or the open thread's, nor an attachment of theirs.
 */
export async function keepWithinRetention(): Promise<void> {
  if (!cacheWindow()) return;
  try {
    await retain();
  } catch (err) {
    logger.info("retention", `skipped: ${String(err)}`);
  }
}

async function retain(): Promise<void> {
  const budget = platform().syncPolicy.retentionBytes;
  const keptByAccount = new Map<string, Set<string>>();
  const keptOf = (accountId: string) => {
    let kept = keptByAccount.get(accountId);
    if (!kept) keptByAccount.set(accountId, (kept = keptThreads(accountId)));
    return kept;
  };
  const bodies = store.listBodies();
  const keptFiles = new Set<string>();
  for (const body of bodies) {
    if (!body.kept && !keptOf(body.accountId).has(body.threadId)) continue;
    body.kept = true;
    for (const name of await attachmentFiles(body.accountId, body.id)) keptFiles.add(name);
  }
  const files = await platform()
    .files.list(ATTACHMENT_DIR)
    .catch(() => []);
  let total =
    bodies.reduce((sum, b) => sum + b.bytes, 0) + files.reduce((sum, f) => sum + f.size, 0);
  if (total <= budget) return;

  type Candidate = { at: number; bytes: number; drop: () => Promise<void> };
  const candidates: Candidate[] = [
    ...bodies
      .filter((b) => !b.kept)
      .map((b) => ({
        at: b.readAt,
        bytes: b.bytes,
        drop: async () => store.dropBody(b.accountId, b.id),
      })),
    ...files
      .filter((f) => !keptFiles.has(f.name))
      .map((f) => ({
        at: f.modifiedAt,
        bytes: f.size,
        drop: () =>
          platform()
            .files.remove(`${ATTACHMENT_DIR}/${f.name}`)
            .catch(() => {}),
      })),
  ].sort((a, b) => a.at - b.at);
  let dropped = 0;
  for (const candidate of candidates) {
    if (total <= budget) break;
    await candidate.drop();
    total -= candidate.bytes;
    dropped += 1;
  }
  logger.info(
    "retention",
    `dropped ${dropped} bodies and attachments to stay under ${budget} bytes`,
  );
}
