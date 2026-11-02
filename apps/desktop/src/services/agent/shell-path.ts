// Desktop launchers omit CLI install paths; read PATH from the user's login shell.

import { spawn } from "node:child_process";
import { logger } from "../../logger.js";

const MARKER = "__OTTER_PATH__";

let fixed: Promise<void> | null = null;

function loginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    const child = spawn(shell, ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`], {
      // Its own session, without a terminal: an interactive shell takes over
      // the terminal the app was started from (`otter-mail &` on Linux),
      // which would stop the app.
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.toString();
    });
    const done = (error?: Error) => {
      const match = stdout.match(new RegExp(`${MARKER}(.*?)${MARKER}`));
      if (error && !match)
        logger.info("agent", "login shell PATH failed", { error: String(error) });
      resolve(match?.[1] ?? null);
    };
    child.once("error", done);
    child.once("close", (code) => done(code === 0 ? undefined : new Error(`exit ${code}`)));
  });
}

export function ensureShellPath(): Promise<void> {
  fixed ??= loginShellPath().then((shellPath) => {
    if (!shellPath) return;
    const merged = [...shellPath.split(":"), ...(process.env.PATH ?? "").split(":")].filter(
      (entry, i, all) => entry && all.indexOf(entry) === i,
    );
    process.env.PATH = merged.join(":");
  });
  return fixed;
}
