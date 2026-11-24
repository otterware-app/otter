import { readJson, writeJson } from "../json-file.ts";
import { platform } from "../platform.ts";
import { getSettings } from "./settings-store.ts";

export type ErrorReportsConfig = { available: boolean; enabled: boolean; reportId: string };

let id: Promise<string> | null = null;

function reportId(): Promise<string> {
  id ??= (async () => {
    const saved = await readJson<{ reportId?: string }>("error-reports.json");
    if (saved?.reportId) return saved.reportId;
    const fresh = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    await writeJson("error-reports.json", { reportId: fresh });
    return fresh;
  })();
  return id;
}

export async function errorReportsConfig(): Promise<ErrorReportsConfig> {
  const [settings, reportIdValue] = await Promise.all([getSettings(), reportId()]);
  const available = platform().errorReports === true;
  return { available, enabled: available && settings.errorReports, reportId: reportIdValue };
}
