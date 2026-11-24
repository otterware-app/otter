import type { SqlDatabase, SqlValue } from "@otter/core";
import { openDatabaseSync, type SQLiteBindValue } from "expo-sqlite";

/**
 * Core's SQLite, in the app's documents (expo-sqlite's own SQLite, with FTS5 and JSON1), on its
 * synchronous API. Each statement is prepared when it runs: core prepares as it goes, and an
 * expo-sqlite statement holds its native handle until it is finalized.
 */
export function openDatabase(name: string): SqlDatabase {
  const db = openDatabaseSync(name);
  db.execSync("PRAGMA journal_mode = WAL;");
  const bind = (params: SqlValue[]) =>
    params.map((p) => (typeof p === "bigint" ? Number(p) : p)) as SQLiteBindValue[];
  return {
    exec: (sql) => db.execSync(sql),
    prepare: (sql) => ({
      get: (...params) => db.getFirstSync<Record<string, SqlValue>>(sql, bind(params)) ?? undefined,
      all: (...params) => db.getAllSync<Record<string, SqlValue>>(sql, bind(params)),
      run: (...params) => ({ changes: db.runSync(sql, bind(params)).changes }),
    }),
  };
}
