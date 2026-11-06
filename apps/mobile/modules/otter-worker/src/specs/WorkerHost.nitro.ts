import type { HybridObject } from "react-native-nitro-modules";

export interface FileEntry {
  name: string;
  size: number;
  modifiedAt: number;
}

/**
 * What core's worker runtime needs from the OS that isn't mail: Nitro itself
 * (`installNitro(runtime)`, a raw JSI method the C++ adds, called from the
 * React Native runtime), randomness, legacy text charsets, the app's files
 * and a log that works in Release builds.
 */
export interface WorkerHost extends HybridObject<{ ios: "c++" }> {
  readonly dataDirectory: string;
  randomBytes(length: number): ArrayBuffer;
  /** The text in a legacy charset (ISO-8859-x, windows-125x, Shift_JIS…), or undefined for an unknown label. */
  decodeText(bytes: ArrayBuffer, label: string): string | undefined;
  readFile(path: string): ArrayBuffer | undefined;
  writeFile(path: string, data: ArrayBuffer): void;
  removeFile(path: string): void;
  listFiles(directory: string): FileEntry[];
  log(level: string, message: string): void;
  now(): number;
  residentMemory(): number;
  /** Milliseconds since this process started (kinfo_proc), for cold-start timing. */
  processUptime(): number;
  /** Resolves `value` from Nitro's thread pool after `delayMs`: the worker's Dispatcher at work. */
  echo(value: number, delayMs: number): Promise<number>;
}
