/**
 * The agents you added (agents.json: each one's kind, name, picture and settings, and the one new
 * chats start with), and their secrets: a Hermes API key or an OpenClaw pairing is full control
 * of the agent, kept in the platform's secrets under the agent's id, never sent to the renderer,
 * never logged.
 */

import { readJson, writeJson } from "../../json-file.js";
import { platform } from "../../platform.js";
import type { AgentEntry, AgentId, AgentSecrets, ProviderSettings } from "./types.js";

const FILE = "agents.json";

let cache: ProviderSettings | null = null;

const isEntry = (value: unknown): value is AgentEntry => {
  const e = value as Partial<AgentEntry> | null;
  return (
    typeof e?.id === "string" &&
    typeof e.kind === "string" &&
    typeof e.name === "string" &&
    typeof e.settings === "object" &&
    e.settings !== null
  );
};

export async function getProviderSettings(): Promise<ProviderSettings> {
  if (cache) return cache;
  const stored = await readJson<Partial<ProviderSettings>>(FILE);
  const agents = Array.isArray(stored?.agents) ? stored.agents.filter(isEntry) : [];
  const removed = Array.isArray(stored?.removed)
    ? stored.removed.filter((id): id is string => typeof id === "string")
    : [];
  cache = {
    selected: typeof stored?.selected === "string" ? stored.selected : null,
    agents,
    removed,
  };
  return cache;
}

export async function saveProviderSettings(next: ProviderSettings): Promise<void> {
  cache = next;
  await writeJson(FILE, next);
}

const secretName = (id: AgentId, name: string) => `agent:${id}:${name}`;

export function agentSecrets(id: AgentId): AgentSecrets {
  return {
    get: async (name) =>
      (await platform()
        .secrets.get(secretName(id, name))
        .catch(() => null)) ?? "",
    set: (name, value) => platform().secrets.set(secretName(id, name), value),
    delete: (name) => platform().secrets.delete(secretName(id, name)),
  };
}
