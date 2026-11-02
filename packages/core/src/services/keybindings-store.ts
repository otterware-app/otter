/**
 * Stores the user's keybindings (a JSON array of `{ key, command, when? }`
 * rules), edited in Settings → Keybindings and synced with the Otter account.
 *
 * The backend is plain storage: it skips entries it can't read and writes
 * atomically. The renderer owns the command list, defaults, merge, and
 * grammar validation.
 */

import { utf8Decode } from "../bytes.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";

export const KEYBINDINGS_FILE = "keybindings.json";

export type KeybindingRule = { key: string; command: string; when?: string };
export type KeybindingsFile = {
  rules: KeybindingRule[] | null;
};

const MAX_RULES = 256;

function asRule(value: unknown): KeybindingRule | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const key = typeof v.key === "string" ? v.key.trim() : "";
  const command = typeof v.command === "string" ? v.command.trim() : "";
  if (!key || key.length > 64 || !command || command.length > 128) return null;
  if (v.when === undefined || v.when === null || v.when === "") return { key, command };
  if (typeof v.when !== "string" || v.when.trim().length > 256) return null;
  const when = v.when.trim();
  return when ? { key, command, when } : { key, command };
}

export async function readKeybindings(): Promise<KeybindingsFile> {
  const bytes = await platform()
    .files.read(KEYBINDINGS_FILE)
    .catch(() => null);
  if (!bytes) return { rules: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(bytes));
  } catch {
    return { rules: [] };
  }
  if (!Array.isArray(parsed)) return { rules: [] };
  const rules = parsed
    .slice(0, MAX_RULES)
    .map(asRule)
    .filter((r): r is KeybindingRule => r !== null);
  return { rules };
}

export async function writeKeybindings(rules: unknown): Promise<KeybindingsFile> {
  if (!Array.isArray(rules)) throw new Error("rules must be an array");
  const clean = rules.map(asRule).filter((r): r is KeybindingRule => r !== null);
  await platform().files.write(
    KEYBINDINGS_FILE,
    JSON.stringify(clean.slice(-MAX_RULES), null, 2) + "\n",
  );
  logger.info("keybindings", `wrote ${clean.length} rules`);
  return { rules: clean };
}
