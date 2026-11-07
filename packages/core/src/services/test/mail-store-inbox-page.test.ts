import { DatabaseSync } from "node:sqlite";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import type { Platform, SqlDatabase } from "../../platform.js";
import type { MessageSummary } from "../../types.js";

const MESSAGES = 100_000;
const ACCOUNT = "me@example.test";

let database: DatabaseSync;
let store: typeof import("../mail-store.js");
let rows: MessageSummary[];

/** Threads of 1–5 messages: some in the inbox, replies sent, a few drafts, spam and trash. */
function seed(): MessageSummary[] {
  let state = 42;
  const random = () => (state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const out: MessageSummary[] = [];
  let thread = 0;
  const start = Date.UTC(2020, 0, 1);
  while (out.length < MESSAGES) {
    thread += 1;
    const size = 1 + Math.floor(random() * 5);
    const inbox = random() < 0.15;
    // Quarter hours apart, and each message's index in ms on top: no two dates tie.
    const at = start + ((thread * 7_919) % 200_000) * 900_000;
    for (let i = 0; i < size && out.length < MESSAGES; i++) {
      const sent = i > 0 && random() < 0.3;
      const draft = !sent && i === size - 1 && random() < 0.05;
      const labels = draft ? ["DRAFT"] : sent ? ["SENT"] : inbox ? ["INBOX"] : [];
      if (!draft && random() < 0.2) labels.push("UNREAD");
      if (random() < 0.03) labels.push("STARRED");
      if (random() < 0.01) labels.push(random() < 0.5 ? "SPAM" : "TRASH");
      if (random() < 0.3) labels.push("CATEGORY_UPDATES");
      out.push({
        id: `m${out.length}`,
        threadId: `t${thread}`,
        subject: `Thread ${thread}`,
        fromEmail: sent ? ACCOUNT : `sender${thread % 500}@example.test`,
        fromName: "Sender",
        to: ACCOUNT,
        snippet: "",
        date: at + i * 3_600_000 + (draft ? 30 * 86_400_000 : 0) + out.length,
        unread: labels.includes("UNREAD"),
        starred: labels.includes("STARRED"),
        labelIds: labels,
        hasAttachments: false,
        messageIdHeader: `<m${out.length}@example.test>`,
      });
    }
  }
  return out;
}

/** What a label's list shows, worked out from the rows themselves. */
function expected(labelId: string, offset: number, limit: number) {
  const threads = new Map<string, MessageSummary[]>();
  for (const m of rows) threads.set(m.threadId, [...(threads.get(m.threadId) ?? []), m]);
  const hidden = (m: MessageSummary) =>
    labelId !== "SPAM" &&
    labelId !== "TRASH" &&
    (m.labelIds.includes("SPAM") || m.labelIds.includes("TRASH"));
  return [...threads]
    .filter(([, messages]) => messages.some((m) => m.labelIds.includes(labelId) && !hidden(m)))
    .map(([threadId, messages]) => {
      const latest = Math.max(...messages.map((m) => m.date));
      const sent = messages.filter((m) => !m.labelIds.includes("DRAFT")).map((m) => m.date);
      const date = labelId === "DRAFT" || sent.length === 0 ? latest : Math.max(...sent);
      return {
        threadId,
        id: messages.find((m) => m.date === latest)!.id,
        date,
        threadCount: messages.length,
        threadUnread: messages.some((m) => m.unread),
      };
    })
    .sort((a, b) => b.date - a.date)
    .slice(offset, offset + limit);
}

beforeAll(async () => {
  vi.resetModules();
  database = new DatabaseSync(":memory:");
  const { setPlatform } = await import("../../platform.js");
  setPlatform({
    database: () => database as unknown as SqlDatabase,
    broadcast: () => {},
    onResume: () => () => {},
    log: () => {},
  } as unknown as Platform);
  store = await import("../mail-store.js");
  rows = seed();
  for (let i = 0; i < rows.length; i += 5_000) {
    store.upsertMessages(ACCOUNT, rows.slice(i, i + 5_000));
  }
}, 120_000);

it("a label's page reads the label's index, not every message of the account", () => {
  const plan = (sql: string) =>
    (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(ACCOUNT, "INBOX") as { detail: string }[])
      .map((r) => r.detail)
      .join("\n");
  const statements: string[] = [];
  const prepare = database.prepare.bind(database);
  const spy = vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
    statements.push(sql);
    return prepare(sql);
  });
  store.getThreadsPage(ACCOUNT, "INBOX", 0, 50);
  spy.mockRestore();
  const page = statements.find((sql) => sql.includes("WITH matched"))!;
  const matched = /WITH matched AS \(([\s\S]*?)\),\s*agg AS/.exec(page)![1]!;
  expect(plan(matched)).toMatch(/^SEARCH ml USING COVERING INDEX idx_mlabels_lookup/);
  expect(plan(matched)).not.toMatch(/SCAN m\b|SEARCH m USING INDEX \w+ \(accountId=\?\)$/m);
  expect(
    plan(
      `SELECT MAX(t.date), MAX(t.unread), COUNT(DISTINCT COALESCE(t.messageIdHeader, t.id))
         FROM messages t WHERE t.accountId = ? AND t.threadId = ?`,
    ),
  ).toMatch(/USING COVERING INDEX idx_messages_thread_rollup/);
});

it("pages every label as before on a 100k-message store", () => {
  for (const labelId of ["INBOX", "SENT", "STARRED", "DRAFT", "CATEGORY_UPDATES", "TRASH"]) {
    for (const offset of [0, 50, 400]) {
      const page = store.getThreadsPage(ACCOUNT, labelId, offset, 50);
      expect(
        page.messages.map((m) => ({
          threadId: m.threadId,
          id: m.id,
          date: m.date,
          threadCount: m.threadCount,
          threadUnread: m.threadUnread,
        })),
        `${labelId} at ${offset}`,
      ).toEqual(expected(labelId, offset, 50));
    }
  }
});

it("answers the inbox's first page quickly", () => {
  store.getThreadsPage(ACCOUNT, "INBOX", 0, 50);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    store.getThreadsPage(ACCOUNT, "INBOX", 0, 50, { aliases: [], sendAs: [] });
    runs.push(performance.now() - started);
  }
  const median = runs.sort((a, b) => a - b)[2]!;
  console.log(`inbox page on ${MESSAGES} messages: ${median.toFixed(1)} ms`);
  // ~45 ms here, ~120 ms before; generous for a loaded CI runner.
  expect(median).toBeLessThan(250);
});
