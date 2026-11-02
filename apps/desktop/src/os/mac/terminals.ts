import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import type { HostOS } from "../types.js";

const exec = promisify(execFile);

const LIST_SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const ws = $.NSWorkspace.sharedWorkspace;
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const fm = $.NSFileManager.defaultManager;
  const name = (u) => fm.displayNameAtPath(u.path).js.replace(/\\.app$/, "");
  const urls = ws.URLsForApplicationsToOpenURL(url);
  const apps = [];
  for (let i = 0; i < urls.count; i++) {
    const u = urls.objectAtIndex(i);
    const bundle = $.NSBundle.bundleWithURL(u);
    const types = ObjC.deepUnwrap(bundle.infoDictionary.objectForKey("CFBundleDocumentTypes")) || [];
    if (!types.some((type) => type.CFBundleTypeRole === "Shell")) continue;
    apps.push({ id: bundle.bundleIdentifier.js, name: name(u) });
  }
  const def = ws.URLForApplicationToOpenURL(url);
  return JSON.stringify({ apps, defaultName: def.isNil() ? null : name(def) });
}
`;

export const macTerminals: HostOS["terminals"] = {
  async list() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "otter-terminal-"));
    try {
      // LaunchServices needs an existing file to resolve its actual default handler.
      const probe = path.join(directory, "probe.command");
      await fs.writeFile(probe, "#!/bin/zsh\nexit 0\n", { mode: 0o700 });
      const { stdout } = await exec(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", LIST_SCRIPT, probe],
        { timeout: 5_000 },
      );
      return JSON.parse(stdout) as Awaited<ReturnType<HostOS["terminals"]["list"]>>;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  async open(launcher, terminalId) {
    const args = terminalId ? ["-b", terminalId, launcher] : [launcher];
    await exec("/usr/bin/open", args, { timeout: 5_000 });
  },
  launcher: { fileName: "Investigate Otter Mail.command", shebang: "#!/bin/zsh -l" },
};
