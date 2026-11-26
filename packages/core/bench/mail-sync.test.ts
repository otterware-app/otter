/**
 * How long Gmail's sync holds the JavaScript thread, for the phone's threading budget
 * (docs/expo-migration.md, gate 3): the made-up mailbox at 50,000 messages, core's real store on
 * an on-disk SQLite in WAL mode, a phone host (`kind: "mobile"`, no offline downloads), and a
 * 10 ms timer whose lateness is what a UI on the same thread would wait. It also reads Inbox
 * pages during sync to exercise the scrolling read path. Skipped unless asked:
 *
 *   OTTER_BENCH=1 pnpm --filter @otter/core exec vp test run bench
 *
 * OTTER_BENCH_MESSAGES sets the size, OTTER_BENCH_LIST_MS how often the Inbox is read (100 ms; the
 * phone's lists refresh every 8 s while a sync writes). The Node database models the phone's adapter
 * (packages/mobile/src/database.ts): statements kept by their SQL, WAL with `synchronous = NORMAL`,
 * a 32 MB page cache.
 * OTTER_BENCH_PREPARE=each prepares on every run instead, as that adapter did at first, and
 * OTTER_BENCH_SYNCHRONOUS=FULL is SQLite's default. Gmail's quota pacing is off: it spreads a
 * real first sync over hours of idle time, which hides nothing about how long each stretch of
 * work is. Set OTTER_BENCH_PROFILE=1 to collect a V8 profile of the longest stalls.
 * The results go to bench/results.json (results-<variant>.json for the others).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, onTestFinished } from "vite-plus/test";

import { DEMO_ACCOUNTS } from "@otter/shared/demo-mailboxes";
import type { Platform, SqlDatabase } from "../src/platform.ts";

const MESSAGES = Number(process.env.OTTER_BENCH_MESSAGES ?? 50_000);
const CHANGES = 200;
const TICK_MS = 10;
const LIST_EVERY_MS = Number(process.env.OTTER_BENCH_LIST_MS ?? 100);
const PAGE_SIZE = 50;
const seed = DEMO_ACCOUNTS[0]!;

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;

/** A 10 ms timer's lateness: each tick's wait past its due time is a stretch nothing else ran. */
function lagSampler() {
  const late: { due: number; at: number }[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let due = now() + TICK_MS;
  const tick = () => {
    const at = now();
    late.push({ due, at });
    due = at + TICK_MS;
    timer = setTimeout(tick, TICK_MS);
  };
  timer = setTimeout(tick, TICK_MS);
  return {
    stop() {
      clearTimeout(timer);
      // Include a stall that ended just as the workload completed, before its tick ran.
      const endedAt = now();
      if (endedAt > due) late.push({ due, at: endedAt });
      const lateness = late.map((t) => t.at - t.due).sort((a, b) => a - b);
      const share = (p: number) =>
        lateness[Math.min(lateness.length - 1, Math.floor(lateness.length * p))] ?? 0;
      return {
        ticks: lateness.length,
        maxMs: round(lateness.at(-1) ?? 0),
        p95Ms: round(share(0.95)),
        p99Ms: round(share(0.99)),
        over16: lateness.filter((ms) => ms > 16).length,
        over50: lateness.filter((ms) => ms > 50).length,
        longest: late
          .toSorted((a, b) => b.at - b.due - (a.at - a.due))
          .slice(0, 40)
          .sort((a, b) => a.due - b.due),
      };
    },
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;

type ProfileNode = {
  id: number;
  callFrame: { functionName: string; url: string };
  children?: number[];
};
type Profile = {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
};

/**
 * Where the 40 longest stretches went: each CPU sample inside one is put down to the innermost
 * frame of core outside the fake, or to the fake (which stands in for the network, not on the
 * phone's thread). Overall, and for the ten longest on their own. `coreMs` is a stretch's samples
 * in core (and the garbage collector), each counted for at most 2 ms: on a busy Mac the process
 * goes unscheduled for hundreds of milliseconds, which is no one's work.
 */
function blame(profile: Profile, long: { due: number; at: number }[], startedAt: number) {
  const parent = new Map<number, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const where = (id: number): string => {
    let leaf = "";
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const { functionName, url } = byId.get(at)!.callFrame;
      const file = url.split("/packages/core/src/")[1];
      if (file?.startsWith("fake/")) return "the fake (the network's stand-in)";
      if (file) {
        const name = functionName || "(anonymous)";
        return `${name} (${file})${leaf && leaf !== name ? ` → ${leaf}` : ""}`;
      }
      leaf ||= functionName;
    }
    return leaf ? `outside core: ${leaf}` : "(idle or native)";
  };
  const perStretch = long.map(() => new Map<string, number>());
  const coreMs = long.map(() => 0);
  const FAKE = "the fake (the network's stand-in)";
  const notCore = new Set([
    FAKE,
    "(idle or native)",
    "outside core: (idle)",
    "outside core: (program)",
  ]);
  let time = startedAt;
  let gap = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    time += profile.timeDeltas[i]! / 1000;
    while (gap < long.length && long[gap]!.at < time) gap++;
    if (gap >= long.length) break;
    if (time < long[gap]!.due) continue;
    const key = where(profile.samples[i]!);
    const totals = perStretch[gap]!;
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    totals.set(key, (totals.get(key) ?? 0) + ms);
    if (!notCore.has(key)) coreMs[gap] = coreMs[gap]! + Math.min(ms, 2);
  }
  const top = (totals: Map<string, number>, count: number) =>
    [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([frame, ms]) => ({ frame, ms: round(ms) }));
  const overall = new Map<string, number>();
  for (const totals of perStretch) {
    for (const [frame, ms] of totals) overall.set(frame, (overall.get(frame) ?? 0) + ms);
  }
  return {
    longestCoreMs: round(Math.max(0, ...coreMs)),
    overall: top(overall, 15),
    longest: long
      .map((stretch, i) => ({
        ms: round(stretch.at - stretch.due),
        coreMs: round(coreMs[i]!),
        frames: top(perStretch[i]!, 3),
      }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10),
  };
}

function memoryFiles(): Platform["files"] {
  const files = new Map<string, Uint8Array>([
    [
      "accounts.json",
      new TextEncoder().encode(
        JSON.stringify([{ id: seed.email, email: seed.email, name: seed.name }]),
      ),
    ],
  ]);
  return {
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    remove: async (path) => {
      files.delete(path);
    },
    list: async () => [],
  };
}

const PREPARE_EACH = process.env.OTTER_BENCH_PREPARE === "each";
const SYNCHRONOUS = process.env.OTTER_BENCH_SYNCHRONOUS ?? "NORMAL";

/** The phone's adapter (packages/mobile/src/database.ts), on node:sqlite. */
function phoneDatabase(path: string): SqlDatabase {
  const db = new DatabaseSync(path);
  db.exec(
    `PRAGMA journal_mode = WAL; PRAGMA synchronous = ${SYNCHRONOUS}; PRAGMA cache_size = -32768;`,
  );
  const kept = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const statement = (sql: string) => {
    if (PREPARE_EACH) return db.prepare(sql);
    let prepared = kept.get(sql);
    if (prepared) kept.delete(sql);
    else prepared = db.prepare(sql);
    if (kept.size >= 200) kept.delete(kept.keys().next().value!);
    kept.set(sql, prepared);
    return prepared;
  };
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => ({
      get: (...params) => statement(sql).get(...params) as never,
      all: (...params) => statement(sql).all(...params) as never,
      run: (...params) => statement(sql).run(...params),
    }),
  };
}

describe.skipIf(!process.env.OTTER_BENCH)("Gmail sync on one thread", () => {
  it(
    `syncs ${MESSAGES} messages, then ${CHANGES} changes`,
    { timeout: 4 * 3_600_000 },
    async () => {
      const { stageLargeGmailChanges, withFakeServices } = await import("../src/fake/index.ts");
      const { startCore } = await import("../src/index.ts");
      const mailSync = await import("../src/services/mail-sync.ts");
      const store = await import("../src/services/mail-store.ts");
      const unused = () => {
        throw new Error("Not in the benchmark.");
      };
      const errors: string[] = [];
      const home = mkdtempSync(join(tmpdir(), "otter-bench-"));
      onTestFinished(() => rmSync(home, { recursive: true, force: true }));
      const database = phoneDatabase(join(home, "mail.db"));
      const fixture = () =>
        withFakeServices(
          {
            kind: "mobile",
            appVersion: "bench",
            log: (level, scope, message) => {
              if (level === "error" || level === "warn") errors.push(`${scope}: ${message}`);
            },
            database: () => database,
            files: memoryFiles(),
            secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
            userFiles: { open: unused, save: unused, pick: unused },
            google: {} as Platform["google"],
            connect: unused,
            relayUrl: "",
            relaySession: "bearer",
            broadcast: () => {},
            notify: () => {},
            setUnreadCount: () => {},
            onResume: () => () => {},
            asyncContext: () => {
              let current: unknown;
              return {
                run: (value, fn) => {
                  const before = current;
                  current = value;
                  try {
                    return fn();
                  } finally {
                    current = before;
                  }
                },
                get: () => current as never,
              };
            },
            offlineDownloads: false,
          },
          { gmailMessages: MESSAGES },
        );
      const status = () => mailSync.getSyncStatus(seed.email);
      const settled = () =>
        status().fullSyncDone &&
        !status().syncing &&
        store.getKv(`spamTrashBackfilled:${seed.email}`) === "1";

      const profileEnabled = process.env.OTTER_BENCH_PROFILE === "1";
      const session = profileEnabled ? new Session() : null;
      if (session) {
        session.connect();
        onTestFinished(() => session.disconnect());
        await session.post("Profiler.enable");
        await session.post("Profiler.setSamplingInterval", { interval: 500 });
      }
      const measure = async (run: (startedAt: number) => Promise<unknown>) => {
        const startRequestedAt = now();
        await session?.post("Profiler.start");
        const startedAt = now();
        const sampler = lagSampler();
        await run(startedAt);
        const durationMs = round(now() - startedAt);
        const { longest, ...lag } = sampler.stop();
        if (!session) return { durationMs, ...lag };
        const stopRequestedAt = now();
        const { profile } = (await session.post("Profiler.stop")) as { profile: Profile };
        // V8's profile clock and Node's hrtime use different origins.
        const profileStartAt = Math.min(
          startedAt,
          Math.max(
            startRequestedAt,
            stopRequestedAt - (profile.endTime - profile.startTime) / 1000,
          ),
        );
        return { durationMs, ...lag, where: blame(profile, longest, profileStartAt) };
      };

      let firstRowsMs = 0;
      let firstRowsAfterFixtureMs = 0;
      let fixtureStartup:
        | (Omit<ReturnType<ReturnType<typeof lagSampler>["stop"]>, "longest"> & {
            durationMs: number;
          })
        | undefined;
      const listReads: { initial: number[]; steady: number[] } = { initial: [], steady: [] };
      function readInbox(reads: number[], offset: number) {
        const startedAt = now();
        const page = store.getThreadsPage(seed.email, "INBOX", offset, PAGE_SIZE);
        reads.push(now() - startedAt);
        return page;
      }

      async function scrollUntil(
        reads: number[],
        done: () => boolean,
        firstRow?: () => void,
      ): Promise<void> {
        let offset = 0;
        const startedAt = now();
        while (now() - startedAt <= 3_600_000) {
          const page = readInbox(reads, offset);
          if (page.messages.length) {
            firstRow?.();
            firstRow = undefined;
          }
          offset = page.hasMore && offset < PAGE_SIZE * 5 ? offset + PAGE_SIZE : 0;
          if (done()) return;
          await new Promise((resolve) => setTimeout(resolve, LIST_EVERY_MS));
        }
        throw new Error("Timed out waiting for sync");
      }

      const firstSync = await measure(async (startedAt) => {
        const fixtureSampler = lagSampler();
        const { microsoft: _outlook, ...gmailOnly } = await fixture();
        const coreStartedAt = now();
        const { longest: _samples, ...lag } = fixtureSampler.stop();
        fixtureStartup = { durationMs: round(coreStartedAt - startedAt), ...lag };
        await startCore(gmailOnly, [], { modules: ["mail"] });
        await scrollUntil(listReads.initial, settled, () => {
          const shownAt = now();
          firstRowsMs = round(shownAt - startedAt);
          firstRowsAfterFixtureMs = round(shownAt - coreStartedAt);
        });
        expect(firstRowsMs).toBeGreaterThan(0);
      });
      const cached = store.countAllMessages(seed.email);
      const pages = (pragma: string) => Number(database.prepare(`PRAGMA ${pragma}`).get()![pragma]);
      const databaseMB = round((pages("page_count") * pages("page_size")) / 1_048_576);
      expect(cached).toBeGreaterThanOrEqual(MESSAGES);

      let expectedCount = cached;
      const fixtureReplay = await measure(async () => {
        expectedCount += await stageLargeGmailChanges(seed.email, CHANGES);
      });
      const before = status().revision;
      const steadyState = await measure(async () => {
        mailSync.syncAccount(seed.email, { force: true, trigger: "push" });
        await scrollUntil(listReads.steady, () => status().revision > before && !status().syncing);
      });
      expect(status().error).toBeNull();
      expect(store.countAllMessages(seed.email)).toBe(expectedCount);

      const results = {
        messages: MESSAGES,
        cached,
        databaseMB,
        prepare: PREPARE_EACH ? "each" : "kept",
        synchronous: SYNCHRONOUS,
        node: process.version,
        loadAverage: loadavg().map(round),
        fixtureStartup,
        firstRowsMs,
        firstRowsAfterFixtureMs,
        fixtureReplay,
        firstSync,
        steadyState,
        listReads: Object.fromEntries(
          Object.entries(listReads).map(([phase, reads]) => {
            reads.sort((a, b) => a - b);
            return [
              phase,
              {
                pages: reads.length,
                maxMs: round(reads.at(-1) ?? 0),
                p95Ms: round(reads[Math.floor(reads.length * 0.95)] ?? 0),
              },
            ];
          }),
        ),
        errors,
      };
      const variant = [
        MESSAGES !== 50_000 && `${MESSAGES}-messages`,
        PREPARE_EACH && "each",
        SYNCHRONOUS !== "NORMAL" && SYNCHRONOUS.toLowerCase(),
        LIST_EVERY_MS !== 100 && `list-${LIST_EVERY_MS}`,
        profileEnabled && "profile",
      ]
        .filter(Boolean)
        .join("-");
      const name = variant ? `results-${variant}.json` : "results.json";
      writeFileSync(join(import.meta.dirname, name), `${JSON.stringify(results, null, 2)}\n`);
    },
  );
});
