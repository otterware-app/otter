import { MAX_SUPPORT_BODY } from "@otter-mail/shared/support";
import { handle } from "../ipc.js";
import { platform } from "../platform.js";
import { errorReportsConfig } from "../services/error-reports.js";
import { collectSupportDiagnostics } from "../services/support.js";
import { runAsTask } from "./ipc-budget.js";

export function registerSupportHandlers(): void {
  handle("support:diagnostics", collectSupportDiagnostics);
  handle("errorReports:config", errorReportsConfig);
  handle("support:saveReport", (params: unknown) => {
    const p = params as { contents?: unknown; filename?: unknown; taskId?: string } | undefined;
    if (typeof p?.contents !== "string" || p.contents.length > MAX_SUPPORT_BODY)
      throw new Error("Invalid report.");
    const bytes = new TextEncoder().encode(p.contents);
    const filename =
      p.filename === "Otter Mail diagnostics.json" ? p.filename : "Otter Mail report.md";
    return runAsTask(p.taskId, () => platform().userFiles.save(filename, bytes));
  });
}
