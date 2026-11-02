import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MailApps } from "../types.js";
import { desktopEntries } from "./desktop-entries.js";

const exec = promisify(execFile);
const MAILTO = "x-scheme-handler/mailto";

export async function listMailApps(): Promise<MailApps> {
  const apps = (await desktopEntries())
    .filter((entry) => entry.mimeTypes.includes(MAILTO))
    .map(({ id, name, path }) => ({ id, name, path }));
  const { stdout } = await exec("xdg-mime", ["query", "default", MAILTO], {
    timeout: 5_000,
  }).catch(() => ({ stdout: "" }));
  const defaultId = stdout.trim();
  return { apps, defaultId: apps.some((app) => app.id === defaultId) ? defaultId : null };
}

export async function setDefaultMailApp(id: string): Promise<void> {
  const { apps } = await listMailApps();
  if (!apps.some((app) => app.id === id)) throw new Error("Choose an installed mail app.");
  await exec("xdg-mime", ["default", id, MAILTO], { timeout: 5_000 });
}
