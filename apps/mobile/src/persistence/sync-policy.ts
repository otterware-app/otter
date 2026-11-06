import type { SyncPolicy } from "@otter-mail/core";

/**
 * A phone keeps the newest of each mailbox and what's opened, syncs while
 * it's in front, and asks the server for the rest (search, older pages).
 */
export const PHONE_SYNC_POLICY: SyncPolicy = {
  initialCoverage: "inbox",
  automaticBackfill: false,
  bodyPrefetch: false,
  retentionBytes: 64 * 1024 * 1024,
  cacheBytes: 200 * 1024 * 1024,
  execution: "foreground",
};
