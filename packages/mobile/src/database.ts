import type { SqlDatabase, SqlValue } from "@otter/core";
import { openDatabaseSync, type SQLiteBindValue, type SQLiteStatement } from "expo-sqlite";

// Core builds some statements per call (`IN (?, ?, …)` lists, searches): the least recently
// used beyond this are finalized.
const KEPT_STATEMENTS = 200;

/**
 * Core's SQLite, in the app's documents (expo-sqlite's own SQLite, with FTS5 and JSON1), on its
 * synchronous API. Statements are prepared once and kept by their SQL: preparing again on every
 * run was half of what a sync's writes cost. Each run reads its rows to the end, or is reset, so
 * no kept statement holds a read open.
 */
export function openDatabase(name: string): SqlDatabase {
  const db = openDatabaseSync(name);
  // WAL with NORMAL: a commit no longer waits on the disk; a crash of the phone (not the app)
  // can lose the last commits, which the next sync fetches again.
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
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
    exec: (sql) => db.execSync(sql),
    prepare: (sql) => ({
      get: (...params) => {
        const result = statement(sql).executeSync<Record<string, SqlValue>>(bind(params));
        try {
          return result.getFirstSync() ?? undefined;
        } finally {
          result.resetSync();
        }
      },
      all: (...params) =>
        statement(sql).executeSync<Record<string, SqlValue>>(bind(params)).getAllSync(),
      run: (...params) => ({ changes: statement(sql).executeSync(bind(params)).changes }),
    }),
  };
}
