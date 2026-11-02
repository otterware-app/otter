import * as fs from "node:fs";
import * as path from "node:path";
import { inspect } from "node:util";

export type Level = "debug" | "info" | "warn" | "error";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
let withDebug = true;

function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  return inspect(value, { depth: 4, breakLength: Infinity });
}

function write(level: Level, scope: string, message: string, data?: unknown): void {
  if (level === "debug" && !withDebug) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${
    data === undefined ? "" : ` ${format(data)}`
  }`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  stream?.write(line + "\n");
}

type Sink = (level: Level, scope: string, message: string, data?: unknown) => void;

let sink: Sink = write;
let report: Sink | null = null;

export function reportLogsTo(reporter: Sink): void {
  report = reporter;
}

export const writeLog: Sink = (level, scope, message, data) => write(level, scope, message, data);

export function logToFile(dir: string, debug: boolean): void {
  withDebug = debug;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "main.log");
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
      fs.renameSync(file, path.join(dir, "main.old.log"));
    }
    stream = fs.createWriteStream(file, { flags: "a" });
  } catch {
    // Console only.
  }
}

export function sendLogsTo(
  send: (level: Level, scope: string, message: string, data?: string) => void,
) {
  sink = (level, scope, message, data) =>
    send(level, scope, message, data === undefined ? undefined : format(data));
}

const log: Sink = (level, scope, message, data) => {
  report?.(level, scope, message, data);
  sink(level, scope, message, data);
};

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => log("debug", scope, message, data),
  info: (scope: string, message: string, data?: unknown) => log("info", scope, message, data),
  warn: (scope: string, message: string, data?: unknown) => log("warn", scope, message, data),
  error: (scope: string, message: string, data?: unknown) => log("error", scope, message, data),
};
