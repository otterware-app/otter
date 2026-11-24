import * as fs from "node:fs/promises";
import * as path from "node:path";
import { summarizeSupportLog, type SupportError } from "@otter/shared/support";
import { appInfo } from "../backend-protocol.ts";
import { backendOS } from "../os/backend.ts";

/** Bounded tail read; the raw log never leaves this process. */
export async function desktopSupportDiagnostics(): Promise<{
  environment: string;
  errors?: SupportError[];
}> {
  const environment = `${backendOS.environment()}; Electron ${process.versions.electron ?? "unknown"}`;
  let errors: SupportError[] | undefined;
  try {
    const file = await fs.open(path.join(appInfo().stateDir, "logs", "main.log"), "r");
    try {
      const { size } = await file.stat();
      const start = Math.max(0, size - 128 * 1024);
      const bytes = Buffer.alloc(size - start);
      const read = await file.read(bytes, 0, bytes.length, start);
      const text = bytes.subarray(0, read.bytesRead).toString("utf-8");
      errors = summarizeSupportLog(start > 0 ? text.slice(text.indexOf("\n") + 1) : text);
    } finally {
      await file.close();
    }
  } catch {
    /* The in-memory summaries remain available if there is no log. */
  }
  return { environment, errors };
}
