import { createHybridObject } from "@otter-mail/mobile-worker";
import type { SqliteDatabase } from "./specs/SqliteDatabase.nitro";

export type SqliteValue = string | number | bigint | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;

export type SqliteConnection = SqliteDatabase & {
  get(sql: string, params: readonly SqliteValue[]): SqliteRow | undefined;
  all(sql: string, params: readonly SqliteValue[]): SqliteRow[];
  run(sql: string, params: readonly SqliteValue[]): { changes: number; lastInsertRowid: number };
};

export function openSqlite(path: string): SqliteConnection {
  const db = createHybridObject<SqliteConnection>("SqliteDatabase");
  db.open(path);
  return db;
}
