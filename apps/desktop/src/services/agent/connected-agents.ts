import {
  agentTokenHash,
  newAgentToken,
  type AgentAccess,
  type ConnectedAgent,
} from "@otter-mail/contracts/agent-tokens";
import { readJson, writeJson, type ToolCaller } from "@otter-mail/core";

import { deviceFiles } from "./local.js";

type StoredAgent = ConnectedAgent & { hash: string };

const FILE = "connected-agents.json";

let stored: Promise<StoredAgent[]> | null = null;
const load = () => (stored ??= readJson<StoredAgent[]>(FILE).then((agents) => agents ?? []));
const save = async () => writeJson(FILE, await load());

const toConnectedAgent = ({ hash: _hash, ...agent }: StoredAgent): ConnectedAgent => agent;

export async function listAgents(): Promise<ConnectedAgent[]> {
  return (await load()).map(toConnectedAgent);
}

export async function addAgent(name: string, access: AgentAccess): Promise<string> {
  const { token, hash } = await newAgentToken("otter_mac_");
  const agents = await load();
  agents.unshift({
    id: crypto.randomUUID(),
    name,
    access,
    createdAt: Date.now(),
    lastUsedAt: null,
    hash,
  });
  await save();
  return token;
}

export async function setAgentAccess(id: string, access: AgentAccess): Promise<void> {
  const agent = (await load()).find((a) => a.id === id);
  if (!agent) throw new Error("That agent's token was revoked.");
  agent.access = access;
  await save();
}

export async function removeAgent(id: string): Promise<void> {
  const agents = await load();
  const index = agents.findIndex((a) => a.id === id);
  if (index >= 0) agents.splice(index, 1);
  await save();
  callers.delete(id);
}

export async function agentCaller(token: string): Promise<ToolCaller | null> {
  const hash = await agentTokenHash(token);
  const agent = (await load()).find((a) => a.hash === hash);
  if (!agent) return null;
  // "Last used" to the minute, so a busy agent doesn't write the file on every call.
  if (Date.now() - (agent.lastUsedAt ?? 0) > 60_000) {
    agent.lastUsedAt = Date.now();
    void save().catch(() => {});
  }
  return callerOf(agent);
}

/** One per agent, so its changes run in the order it asked for them. */
const callers = new Map<string, ToolCaller>();

function callerOf(agent: StoredAgent): ToolCaller {
  const existing = callers.get(agent.id);
  if (existing) return existing;
  const caller: ToolCaller = {
    mode: () => "full-access",
    access: () => agent.access,
    turn: () => null,
    files: deviceFiles,
  };
  callers.set(agent.id, caller);
  return caller;
}
