import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { resolveDevHome } from "./dev-home.mjs";
import { desktopDir, electronChildEnv, resolveElectronPath } from "./electron-launcher.mjs";

const required = [
  NodePath.join(desktopDir, "dist-electron", "main.cjs"),
  NodePath.join(desktopDir, "dist-electron", "preload.cjs"),
  NodePath.join(desktopDir, "..", "web", "dist", "index.html"),
];
const missing = required.filter((file) => !NodeFS.existsSync(file));
if (missing.length > 0) {
  console.error(
    `Missing build output:\n${missing.map((file) => `  ${NodePath.relative(process.cwd(), file)}`).join("\n")}\nRun \`pnpm build\` first.`,
  );
  process.exit(1);
}

const env = electronChildEnv();
delete env.VITE_DEV_SERVER_URL;
const home = resolveDevHome({ cwd: desktopDir });
if (home) env.OTTER_MAIL_HOME = home;
else delete env.OTTER_MAIL_HOME;

const child = NodeChildProcess.spawn(resolveElectronPath(), [desktopDir], {
  cwd: desktopDir,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
