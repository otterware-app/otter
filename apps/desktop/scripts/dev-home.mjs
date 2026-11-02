// A worktree home must override inherited OTTER_MAIL_HOME to protect the installed app's database.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export function resolveLinkedWorktree(cwd) {
  let directory = NodePath.resolve(cwd);
  for (;;) {
    const gitPath = NodePath.join(directory, ".git");
    let stat = null;
    try {
      stat = NodeFS.statSync(gitPath);
    } catch {
      // Keep walking up.
    }
    if (stat) {
      if (!stat.isFile()) return undefined;
      const gitdir = NodeFS.readFileSync(gitPath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("gitdir:"))
        ?.slice("gitdir:".length)
        .trim();
      const segments = (gitdir ?? "").split(/[/\\]/).filter(Boolean);
      return segments.length >= 3 && segments.at(-2) === "worktrees" ? directory : undefined;
    }
    const parent = NodePath.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function resolveDevHome({ cwd, explicitHome, env = process.env }) {
  const explicit = explicitHome?.trim();
  if (explicit) return NodePath.resolve(explicit);
  const worktree = resolveLinkedWorktree(cwd);
  if (worktree) return NodePath.join(worktree, ".otter-mail");
  const ambient = env.OTTER_MAIL_HOME?.trim();
  return ambient ? NodePath.resolve(ambient) : undefined;
}
