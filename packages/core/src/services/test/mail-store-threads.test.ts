import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Platform, SqlDatabase } from "../../platform.ts";
import type { MessageSummary } from "../../types.ts";

let database: DatabaseSync;
let store: typeof import("../mail-store.ts");

const row = (id: string, threadId: string, date: number, labels: string[]): MessageSummary => ({
  id,
  threadId,
  subject: threadId,
  fromEmail: "them@example.com",
  fromName: "Them",
  to: "me@example.com",
  snippet: "",
  date,
  unread: false,
  starred: false,
  labelIds: labels,
  hasAttachments: false,
});

async function open(prepare?: (db: DatabaseSync) => void) {
  vi.resetModules();
  database = new DatabaseSync(":memory:");
  prepare?.(database);
  const { setPlatform } = await import("../../platform.ts");
  setPlatform({
    database: () => database as unknown as SqlDatabase,
    broadcast: () => {},
    onResume: () => () => {},
    log: () => {},
  } as unknown as Platform);
  store = await import("../mail-store.ts");
}

beforeEach(async () => {
  await open();
  store.upsertMessages("me", [
    row("old", "replied", 100, ["INBOX"]),
    row("draft", "replied", 300, ["DRAFT"]),
    row("newer", "other", 200, ["INBOX"]),
    row("compose", "new", 400, ["DRAFT"]),
  ]);
});
afterEach(() => database.close());

it("a draft doesn't move its thread up the list", () => {
  const inbox = store.getThreadsPage("me", "INBOX", 0, 10).messages;
  expect(inbox.map((m) => [m.threadId, m.id, m.date])).toEqual([
    ["other", "newer", 200],
    ["replied", "draft", 100],
  ]);
});

it("pages a dense Inbox by thread date and keeps older results in a sparse Inbox", () => {
  const rows = [
    row("sent", "replied", 200, ["SENT"]),
    row("trashed", "replied", 600, ["TRASH"]),
    row("binned", "binned", 700, ["INBOX", "SPAM"]),
    row("draft-only", "draft-only", 150, ["INBOX", "DRAFT"]),
    row("one", "one", 810, ["INBOX"]),
    row("two", "two", 810, ["INBOX"]),
    row("two-copy", "two", 810, ["INBOX"]),
  ];
  store.upsertMessages("me", rows);
  const baseline = { aliases: [], sendAs: [] };
  for (const offset of [0, 1, 2, 3, 4]) {
    expect(store.getThreadsPage("me", "INBOX", offset, 1)).toEqual(
      store.getThreadsPage("me", "INBOX", offset, 1, baseline),
    );
  }

  store.upsertMessages(
    "me",
    Array.from({ length: 1024 }, (_, i) => row(`archived-${i}`, `archived-${i}`, 1_000 + i, [])),
  );
  expect(store.getThreadsPage("me", "INBOX", 0, 2)).toEqual(
    store.getThreadsPage("me", "INBOX", 0, 2, baseline),
  );
});

it("the Drafts view sorts by the drafts themselves", () => {
  const drafts = store.getThreadsPage("me", "DRAFT", 0, 10).messages;
  expect(drafts.map((m) => [m.threadId, m.date])).toEqual([
    ["new", 400],
    ["replied", 300],
  ]);
});

it("keeps a message's Reply-To with its detail", () => {
  const detail = { ...row("asked", "ticket", 500, ["INBOX"]), bodyHtml: null, bodyText: "Hi" };
  store.upsertMessageDetail("me", {
    ...detail,
    replyTo: "Support <help@example.com>",
    attachments: [],
  });
  expect(store.getMessageDetail("me", "asked")?.replyTo).toBe("Support <help@example.com>");
  store.upsertMessageDetail("me", { ...detail, attachments: [] });
  expect(store.getMessageDetail("me", "asked")?.replyTo).toBeUndefined();
});

it("reads details cached before Reply-To was kept again", async () => {
  database.close();
  await open((db) => {
    db.exec(`CREATE TABLE messages (
    accountId TEXT NOT NULL, id TEXT NOT NULL, threadId TEXT NOT NULL,
    fromName TEXT NOT NULL DEFAULT '', fromEmail TEXT NOT NULL DEFAULT '',
    toField TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '', date INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
    hasAttachments INTEGER NOT NULL DEFAULT 0, labelIds TEXT NOT NULL DEFAULT '[]',
    cc TEXT, bodyHtml TEXT, bodyText TEXT, attachments TEXT,
    detailFetched INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (accountId, id))`);
    db.exec(`INSERT INTO messages (accountId, id, threadId, bodyText, attachments, detailFetched)
      VALUES ('me', 'cached', 'cached', 'Hi', '[]', 1)`);
  });
  expect(store.getMessageDetail("me", "cached")).toBeNull();
  expect(store.getUndownloadedMessages("me", 10).map((m) => m.id)).toEqual(["cached"]);
});

it("rolls a conversation up from what's outside Trash and Junk, except in those views", () => {
  store.upsertMessages("me", [
    { ...row("asked", "mixed", 500, ["INBOX", "STARRED"]), starred: true },
    row("reply", "mixed", 600, ["SENT"]),
    row("discarded", "mixed", 700, ["TRASH", "DRAFT"]),
  ]);
  const [inbox] = store.getThreadsPage("me", "INBOX", 0, 1).messages;
  expect(inbox).toMatchObject({ id: "reply", threadCount: 2, threadStarred: true });
  expect(inbox.threadLabelIds).not.toContain("TRASH");
  const [trash] = store.getThreadsPage("me", "TRASH", 0, 1).messages;
  expect(trash).toMatchObject({ id: "discarded", threadCount: 3 });
  expect(trash.threadLabelIds).toContain("TRASH");
});

it("counts a label's mail as its list shows it: what's in Trash and Junk only there", () => {
  store.upsertLabels(
    "me",
    ["DRAFT", "TRASH", "category:Later"].map((id) => ({ id, name: id, type: "system" as const })),
  );
  store.upsertMessages("me", [
    row("discarded", "binned", 500, ["TRASH", "DRAFT", "category:Later"]),
    { ...row("later", "kept", 600, ["INBOX", "UNREAD", "category:Later"]), unread: true },
  ]);
  store.recountLabels("me", ["DRAFT", "TRASH"]);
  const total = (id: string) => store.getLabels("me").find((l) => l.id === id)?.total;
  expect(total("DRAFT")).toBe(store.getThreadsPage("me", "DRAFT", 0, 10).messages.length);
  expect(total("TRASH")).toBe(1);
  expect(store.countLabel("me", "category:Later")).toEqual({ total: 1, unread: 1 });
});
