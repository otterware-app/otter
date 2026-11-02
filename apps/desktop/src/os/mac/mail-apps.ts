// Pass values to LaunchServices scripts as argv, never through string interpolation.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MailApps } from "../types.js";

const execFileAsync = promisify(execFile);

async function runJxa(script: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    script,
    ...args,
  ]);
  return stdout.trim();
}

const LIST_SCRIPT = `
ObjC.import("AppKit");
function run() {
  const ws = $.NSWorkspace.sharedWorkspace;
  const url = $.NSURL.URLWithString("mailto:probe@example.com");
  const fm = $.NSFileManager.defaultManager;
  const bundleIdAt = (u) => {
    const b = $.NSBundle.bundleWithURL(u);
    if (b.isNil()) return null;
    const bid = b.bundleIdentifier;
    return bid.isNil() ? null : bid.js;
  };
  const apps = [];
  const urls = ws.URLsForApplicationsToOpenURL(url);
  for (let i = 0; i < urls.count; i++) {
    const u = urls.objectAtIndex(i);
    const bundleId = bundleIdAt(u);
    if (!bundleId) continue;
    apps.push({
      id: bundleId,
      path: u.path.js,
      name: fm.displayNameAtPath(u.path).js.replace(/\\.app$/, ""),
    });
  }
  const def = ws.URLForApplicationToOpenURL(url);
  return JSON.stringify({
    apps,
    defaultId: def.isNil() ? null : bundleIdAt(def),
  });
}
`;

const SET_SCRIPT = `
ObjC.import("CoreServices");
function run(argv) {
  const status = $.LSSetDefaultHandlerForURLScheme($("mailto"), $(argv[0]));
  return JSON.stringify({ status });
}
`;

export async function listMailApps(): Promise<MailApps> {
  const parsed = JSON.parse(await runJxa(LIST_SCRIPT)) as MailApps;
  const seen = new Set<string>();
  const apps = parsed.apps.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return { apps, defaultId: parsed.defaultId };
}

export async function setDefaultMailApp(bundleId: string): Promise<void> {
  const { status } = JSON.parse(await runJxa(SET_SCRIPT, [bundleId])) as { status: number };
  if (status !== 0) {
    throw new Error(`LSSetDefaultHandlerForURLScheme failed with status ${status}`);
  }
}
