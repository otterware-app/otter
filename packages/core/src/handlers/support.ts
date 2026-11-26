import { MAX_SUPPORT_BODY } from "@otter/shared/support";
import { handle } from "../ipc.ts";
import { platform } from "../platform.ts";
import { errorReportsConfig, followErrorReportsConfig } from "../services/error-reports.ts";
import { collectSupportDiagnostics } from "../services/support.ts";
import { runAsTask } from "./ipc-budget.ts";

export function registerSupportHandlers(): void {
  handle("support:diagnostics", collectSupportDiagnostics);
  handle("errorReports:config", errorReportsConfig);
  followErrorReportsConfig();
  handle("support:saveReport", (params: unknown) => {
    const p = params as { contents?: unknown; filename?: unknown; taskId?: string } | undefined;
    if (typeof p?.contents !== "string" || p.contents.length > MAX_SUPPORT_BODY)
      throw new Error("Invalid report.");
    const bytes = new TextEncoder().encode(p.contents);
    const filename = p.filename === "Otter diagnostics.json" ? p.filename : "Otter report.md";
    return runAsTask(p.taskId, () => platform().userFiles.save(filename, bytes));
  });
}
