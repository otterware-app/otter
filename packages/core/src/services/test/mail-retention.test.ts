import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { Platform, SqlDatabase } from "../../platform.js";
import type { MessageDetail } from "../../types.js";

let store: typeof import("../mail-store.js");

const detail = (id: string, date: number, labelIds: string[], body = 5_000): MessageDetail => ({
  id,
  threadId: id,
  fromName: "Sender",
  fromEmail: "sender@example.test",
  to: "me@example.test",
  subject: `Subject ${id}`,
  snippet: "",
  date,
  unread: false,
  starred: labelIds.includes("STARRED"),
  labelIds,
  hasAttachments: false,
  bodyHtml: null,
  bodyText: "x".repeat(body),
  attachments: [],
});

beforeEach(async () => {
  vi.resetModules();
  const database = new DatabaseSync(":memory:");
  const { setPlatform } = await import("../../platform.js");
  setPlatform({
    database: () => database as unknown as SqlDatabase,
    broadcast: () => {},
    onResume: () => () => {},
    log: () => {},
  } as unknown as Platform);
  store = await import("../mail-store.js");
});

it("drops the least recently opened bodies first, then rows past each mailbox's newest", () => {
  const now = Date.now();
  store.upsertMessageDetails(
    "me",
    Array.from({ length: 40 }, (_, i) => detail(`m${i}`, now - i * 60_000, ["INBOX"])),
  );
  store.touchMessages("me", ["m39"]);
  const before = store.cachedBytes();
  expect(before.bodies).toBeGreaterThanOrEqual(40 * 5_000);

  const { bodiesDropped, rowsDropped } = store.evictToFit(before.rows + 20 * 5_002, 10);
  expect(bodiesDropped).toBe(20);
  expect(rowsDropped).toBe(0);
  expect(store.getMessageDetail("me", "m39")?.bodyText).toHaveLength(5_000);
  expect(store.getMessageDetail("me", "m38")).toBeNull();
  expect(store.getMessageDetail("me", "m0")?.bodyText).toHaveLength(5_000);

  const rows = store.evictToFit(0, 10);
  expect(rows.rowsDropped).toBe(30);
  expect(store.countAllMessages("me")).toBe(10);
  expect(store.getSyncState("me").fullSyncDone).toBe(false);
});

it("never lets drafts, scheduled or starred mail go", () => {
  const now = Date.now();
  store.upsertMessageDetails("me", [
    detail("draft", now - 10 * 86_400_000, ["DRAFT"]),
    detail("starred", now - 10 * 86_400_000, ["INBOX", "STARRED"]),
    detail("scheduled", now - 10 * 86_400_000, ["SCHEDULED"]),
    detail("old", now - 10 * 86_400_000, ["INBOX"]),
    ...Array.from({ length: 5 }, (_, i) => detail(`new${i}`, now - i, ["INBOX"])),
  ]);
  store.evictToFit(0, 0);
  const left = new Set(store.getAllMessageLabels("me").keys());
  expect(left).toEqual(new Set(["draft", "starred", "scheduled"]));
  expect(store.getMessageDetail("me", "draft")?.bodyText).toHaveLength(5_000);
});
