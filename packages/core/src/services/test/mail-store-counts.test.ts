import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Platform, SqlDatabase } from "../../platform.ts";
import type { MailLabel, MessageSummary } from "../../types.ts";

const LABELS = [
  "INBOX",
  "UNREAD",
  "STARRED",
  "SPAM",
  "TRASH",
  "DRAFT",
  "SENT",
  "Label_1",
  "Label_2",
];

let database: DatabaseSync;
let store: typeof import("../mail-store.ts");

/** mulberry32: the same changes on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const row = (id: string, labelIds: string[]): MessageSummary => ({
  id,
  threadId: id,
  subject: id,
  fromEmail: "them@example.com",
  fromName: "Them",
  to: "me@example.com",
  snippet: "",
  date: 1,
  unread: labelIds.includes("UNREAD"),
  starred: labelIds.includes("STARRED"),
  labelIds,
  hasAttachments: false,
});

beforeEach(async () => {
  vi.resetModules();
  database = new DatabaseSync(":memory:");
  const { setPlatform } = await import("../../platform.ts");
  setPlatform({
    database: () => database as unknown as SqlDatabase,
    broadcast: () => {},
    onResume: () => () => {},
    log: () => {},
  } as unknown as Platform);
  store = await import("../mail-store.ts");
});
afterEach(() => database.close());

function expectExact(labelIds = LABELS) {
  const kept = new Map(store.getLabels("me").map((l) => [l.id, l]));
  for (const id of labelIds) {
    const { total, unread } = store.countLabel("me", id);
    expect({ id, total: kept.get(id)?.total, unread: kept.get(id)?.unread }).toEqual({
      id,
      total,
      unread,
    });
  }
}

it("keeps every label's counts exact through many mixed changes", () => {
  const rand = random(7);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)]!;
  const someLabels = () => LABELS.filter(() => rand() < 0.3);
  const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);

  store.upsertMessages(
    "me",
    ids.slice(0, 30).map((id) => row(id, someLabels())),
  );
  store.upsertLabels(
    "me",
    LABELS.map((id): MailLabel => ({ id, name: id, type: "system" })),
  );
  store.recountLabels("me", LABELS);
  expectExact();

  for (let step = 0; step < 600; step++) {
    const kind = pick(["history", "label", "delete", "upsert", "rename"]);
    if (kind === "history") {
      const ops: import("../mail-store.ts").HistoryOp[] = Array.from(
        { length: 1 + Math.floor(rand() * 6) },
        () => {
          const id = pick(ids);
          const what = pick(["labelsAdded", "labelsRemoved", "deleted"] as const);
          return what === "deleted"
            ? { kind: what, id }
            : { kind: what, id, labelIds: someLabels() };
        },
      );
      store.applyHistoryChanges("me", ops);
    } else if (kind === "label") {
      store.applyLabelChange("me", pick(ids), someLabels(), someLabels());
    } else if (kind === "delete") {
      store.deleteMessage("me", pick(ids));
    } else if (kind === "upsert") {
      const batch = Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
        row(pick(ids), someLabels()),
      );
      store.upsertMessages("me", batch, { counted: true });
    } else {
      store.renameMessage("me", pick(ids), pick(ids), someLabels());
    }
    expectExact();
  }
});

it("counts a label whole when it has no counts yet", () => {
  store.upsertMessages("me", [row("a", ["INBOX", "UNREAD"]), row("b", ["INBOX"])]);
  store.upsertLabels("me", [{ id: "INBOX", name: "INBOX", type: "system" }]);
  store.applyLabelChange("me", "b", ["UNREAD"], []);
  expectExact(["INBOX"]);
  expect(store.getLabels("me")[0]).toMatchObject({ total: 2, unread: 2 });
});

it("moves the server's counts by what changes here, while the mailbox is still filling", () => {
  store.upsertLabels("me", [
    { id: "INBOX", name: "INBOX", type: "system", total: 500, unread: 40 },
  ]);
  store.upsertMessages("me", [row("old", ["INBOX", "UNREAD"])]);
  expect(store.getLabels("me")[0]).toMatchObject({ total: 500, unread: 40 });
  store.upsertMessages("me", [row("new", ["INBOX", "UNREAD"])], { counted: true });
  expect(store.getLabels("me")[0]).toMatchObject({ total: 501, unread: 41 });
  store.applyHistoryChanges("me", [{ kind: "labelsAdded", id: "old", labelIds: ["TRASH"] }]);
  expect(store.getLabels("me")[0]).toMatchObject({ total: 500, unread: 40 });
});

it("keeps an optimistic label change while applying older Gmail history", async () => {
  const { trackLabelWrite } = await import("../pending-label-writes.ts");
  store.upsertLabels("me", [{ id: "INBOX", name: "INBOX", type: "system", total: 0, unread: 0 }]);
  store.upsertMessages("me", [row("a", ["INBOX", "UNREAD"])], { counted: true });
  const archive = trackLabelWrite("me", ["a"], [], ["INBOX"]);
  store.applyLabelChange("me", "a", [], ["INBOX"]);
  try {
    store.applyHistoryChanges(
      "me",
      [{ kind: "labelsAdded", id: "a", labelIds: ["INBOX", "STARRED"] }],
      { keepPending: true },
    );
    expect(store.getMessageLabelIds("me", "a")?.toSorted()).toEqual(["STARRED", "UNREAD"]);
    expect(store.getLabels("me")[0]).toMatchObject({ total: 0, unread: 0 });
    expectExact(["INBOX"]);
  } finally {
    archive.dropped();
  }
});

it("uses the unread flag for the inbox badge and supports excluded accounts", () => {
  store.upsertMessages("me", [{ ...row("a", ["INBOX"]), unread: true }]);
  store.upsertMessages("other", [row("a", ["INBOX", "UNREAD"])]);
  expect(store.countInboxUnreadAll()).toBe(2);
  expect(store.countInboxUnreadAll(new Set(["other"]))).toBe(1);
});

it("rolls back the sync cursor when its replay checkpoint fails", () => {
  store.setSyncState("me", { historyId: "100" });
  database.exec(`
    CREATE TRIGGER fail_replay_checkpoint BEFORE INSERT ON kv
    WHEN NEW.key = 'replayFrom:me' BEGIN
      SELECT RAISE(ABORT, 'checkpoint failed');
    END;
  `);

  expect(() =>
    store.setSyncCheckpoint(
      "me",
      { historyId: "200", fullSyncDone: true },
      { "fullSyncSeed:me": "", "replayFrom:me": "100" },
    ),
  ).toThrow("checkpoint failed");
  expect(store.getSyncState("me")).toMatchObject({ historyId: "100", fullSyncDone: false });
  expect(store.getKv("fullSyncSeed:me")).toBeNull();
});
