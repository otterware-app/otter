import type { SqlDatabase, SqlValue } from "@otter/core";
import {
  openDatabaseAsync,
  openDatabaseSync,
  type SQLiteBindValue,
  type SQLiteDatabase,
  type SQLiteStatement,
} from "expo-sqlite";

import { measureSqlite } from "./long-tasks.ts";

// Core builds some statements per call (`IN (?, ?, …)` lists, searches): the least recently
// used beyond this are finalized.
const KEPT_STATEMENTS = 200;

/**
 * Core's SQLite, in the app's documents (expo-sqlite's own SQLite, with FTS5 and JSON1), on its
 * synchronous API. Statements are prepared once and kept by their SQL: preparing again on every
 * run was half of what a sync's writes cost. Each run reads its rows to the end, or is reset, so
 * no kept statement holds a read open.
 */
export function openDatabase(name: string, backgroundCheckpoints = false): SqlDatabase {
  const db = openDatabaseSync(name);
  // WAL with NORMAL: a commit no longer waits on the disk; a crash of the phone (not the app)
  // can lose the last commits, which the next sync fetches again.
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  // A commit crossing SQLite's WAL threshold would otherwise checkpoint on the JS thread.
  // A separate connection ensures the checkpoint doesn't hold the foreground connection's mutex.
  let checkpoint: SQLiteDatabase | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let flushing = false;
  function scheduleCheckpoint() {
    dirty = true;
    if (!checkpoint || timer || flushing) return;
    timer = setTimeout(async () => {
      timer = undefined;
      flushing = true;
      dirty = false;
      const connection = checkpoint;
      try {
        const status = await connection?.getFirstAsync<{ log: number; checkpointed: number }>(
          "PRAGMA wal_checkpoint(PASSIVE)",
        );
        dirty ||= Boolean(status && status.checkpointed < status.log);
      } catch (error) {
        console.warn("Couldn't checkpoint SQLite in the background", error);
        checkpoint = undefined;
        db.execSync("PRAGMA wal_autocheckpoint = 1000");
        void connection?.closeAsync().catch(() => {});
      } finally {
        flushing = false;
        if (dirty) scheduleCheckpoint();
      }
    }, 2000);
  }
  if (backgroundCheckpoints) {
    void openDatabaseAsync(name, { useNewConnection: true })
      .then(async (connection) => {
        await connection.execAsync("PRAGMA synchronous = NORMAL");
        db.execSync("PRAGMA wal_autocheckpoint = 0");
        checkpoint = connection;
        scheduleCheckpoint();
      })
      .catch((error: unknown) =>
        console.warn("Couldn't open a SQLite checkpoint connection", error),
      );
  }

  const kept = new Map<string, SQLiteStatement>();
  const statement = (sql: string) => {
    let prepared = kept.get(sql);
    if (prepared) {
      kept.delete(sql);
    } else {
      if (kept.size >= KEPT_STATEMENTS) {
        const [oldest, stale] = kept.entries().next().value!;
        kept.delete(oldest);
        stale.finalizeSync();
      }
      prepared = db.prepareSync(sql);
    }
    kept.set(sql, prepared);
    return prepared;
  };
  const bind = (params: SqlValue[]) =>
    params.map((p) => (typeof p === "bigint" ? Number(p) : p)) as SQLiteBindValue[];
  return {
    exec: (sql) => {
      measureSqlite(sql === "COMMIT" ? "commit" : "exec", () => db.execSync(sql));
      if (sql === "COMMIT") scheduleCheckpoint();
    },
    prepare: (sql) => ({
      get: (...params) =>
        measureSqlite("read", () => {
          const result = statement(sql).executeSync<Record<string, SqlValue>>(bind(params));
          try {
            return result.getFirstSync() ?? undefined;
          } finally {
            result.resetSync();
          }
        }),
      all: (...params) =>
        measureSqlite("read", () =>
          statement(sql).executeSync<Record<string, SqlValue>>(bind(params)).getAllSync(),
        ),
      run: (...params) =>
        measureSqlite("write", () => {
          const { changes } = statement(sql).executeSync(bind(params));
          if (changes) scheduleCheckpoint();
          return { changes };
        }),
    }),
  };
}
