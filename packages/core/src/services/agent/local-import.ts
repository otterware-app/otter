/**
 * Where this device kept agents and chats before the account kept them (agents.json, the `chats`
 * and `chat_turns` tables, the secrets that were its own): sent to the account once, whole. A chat
 * the account has newer keeps its own fields and takes the turns only this device had.
 */

import type { AgentMutation } from "@otter/contracts/agent-sync";
import type { Chat, ChatTurn } from "@otter/contracts/chats";

import { registeredAgents } from "../../extensions.js";
import { readJson } from "../../json-file.js";
import { logger } from "../../logger.js";
import { platform } from "../../platform.js";
import { agentDb, deviceId, keepDeviceId, mutate, transaction } from "../agent-sync.js";
import type { AgentEntry } from "./types.js";

const AGENTS_FILE = "agents.json";

const hasTable = (name: string) =>
  agentDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined;

async function agentMutations(stored: {
  selected?: unknown;
  agents?: unknown;
  removed?: unknown;
}): Promise<AgentMutation[]> {
  const device = deviceId();
  const mutations: AgentMutation[] = [];
  const agents = (Array.isArray(stored.agents) ? stored.agents : []) as Partial<AgentEntry>[];
  for (const [addedAt, agent] of agents.entries()) {
    if (typeof agent?.id !== "string" || typeof agent.kind !== "string") continue;
    if (typeof agent.name !== "string" || !agent.name) continue;
    const type = registeredAgents().get(agent.kind);
    const own = (type?.deviceFields ?? []) as readonly string[];
    const settings = Object.entries((agent.settings ?? {}) as Record<string, unknown>);
    mutations.push({
      op: "agent.set",
      id: agent.id,
      kind: agent.kind,
      name: agent.name,
      ...(agent.avatar && { avatar: agent.avatar }),
      settings: Object.fromEntries(settings.filter(([key]) => !own.includes(key))),
      addedAt,
    });
    const mine = Object.fromEntries(settings.filter(([key]) => own.includes(key)));
    if (Object.keys(mine).length > 0)
      mutations.push({ op: "agent.device", id: agent.id, device, settings: mine });
    for (const name of type?.secrets ?? []) {
      if (type?.deviceSecrets?.includes(name)) continue;
      const value = await platform()
        .secrets.get(`agent:${agent.id}:${name}`)
        .catch(() => null);
      if (value) mutations.push({ op: "secret.set", agent: agent.id, name, value });
    }
  }
  for (const id of Array.isArray(stored.removed) ? stored.removed : [])
    if (typeof id === "string") mutations.push({ op: "agent.remove", id });
  if (typeof stored.selected === "string") mutations.push({ op: "select", id: stored.selected });
  return mutations;
}

function chatMutations(): AgentMutation[] {
  if (!hasTable("chats") || !hasTable("chat_turns")) return [];
  const db = agentDb();
  const mutations: AgentMutation[] = [];
  for (const row of db.prepare("SELECT id, chat FROM chats").all()) {
    const id = String(row.id);
    const chat = JSON.parse(String(row.chat)) as Omit<Chat, "turns">;
    const turns = db
      .prepare("SELECT turn FROM chat_turns WHERE chatId = ? ORDER BY position")
      .all(id)
      .map((t) => JSON.parse(String(t.turn)) as ChatTurn);
    mutations.push({ op: "chat.set", chat, ifNewer: true });
    mutations.push({
      op: "turns",
      chat: id,
      put: turns,
      order: turns.map((t) => t.id),
      imported: true,
    });
  }
  return mutations;
}

export async function importLocalAgentData(): Promise<void> {
  const db = agentDb();
  const stored = await readJson<Record<string, unknown>>(AGENTS_FILE);
  if (!stored && !hasTable("chats")) return;
  if (hasTable("chat_state")) {
    const saved = db.prepare("SELECT value FROM chat_state WHERE key = 'device'").get();
    const id = saved && (JSON.parse(String(saved.value)) as { id?: unknown }).id;
    if (typeof id === "string") keepDeviceId(id);
  }
  const mutations = [...(stored ? await agentMutations(stored) : []), ...chatMutations()];
  logger.info("agent-sync", "Sending this device's agents and chats to the account", {
    mutations: mutations.length,
  });
  await mutate(mutations);
  transaction(db, () =>
    db.exec(
      "DROP TABLE IF EXISTS chat_turns; DROP TABLE IF EXISTS chats; DROP TABLE IF EXISTS chat_state;",
    ),
  );
  await platform().files.remove(AGENTS_FILE);
}
