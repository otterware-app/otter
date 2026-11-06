import type { HybridObject } from "react-native-nitro-modules";

/**
 * A synchronous SQLite connection (the amalgamation, FTS5 compiled in, WAL).
 * `get`, `all` and `run(sql, params)` are raw JSI methods the C++ adds, so rows
 * become JS objects without a trip through Nitro's converters; statements are
 * cached by their SQL.
 */
export interface SqliteDatabase extends HybridObject<{ ios: "c++" }> {
  open(path: string): void;
  close(): void;
  exec(sql: string): void;
  readonly version: string;
  compileOptions(): string[];
}
