// Worktrees use a stable port offset so dev runs can coexist; PORT and OTTER_PORT_OFFSET override it.

import * as NodeCrypto from "node:crypto";

import { resolveLinkedWorktree } from "../apps/desktop/scripts/dev-home.mjs";

export const BASE_WEB_PORT = 5833;
const MAX_HASH_OFFSET = 3000;

export function hashOffset(seed: string): number {
  const digest = NodeCrypto.createHash("sha256").update(seed).digest();
  return (digest.readUInt32BE(0) % MAX_HASH_OFFSET) + 1;
}

export function resolvePortOffset(
  env: NodeJS.ProcessEnv,
  root: string,
): { offset: number; source: string } {
  const raw = env.OTTER_PORT_OFFSET?.trim();
  if (raw) {
    const offset = Number(raw);
    if (!Number.isInteger(offset) || offset < 0 || BASE_WEB_PORT + offset > 65535) {
      throw new Error(`OTTER_PORT_OFFSET must be a non-negative integer; received "${raw}".`);
    }
    return { offset, source: `OTTER_PORT_OFFSET=${offset}` };
  }
  if (resolveLinkedWorktree(root)) return { offset: hashOffset(root), source: `worktree ${root}` };
  return { offset: 0, source: "default port" };
}
