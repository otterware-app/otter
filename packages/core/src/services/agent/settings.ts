/**
 * The agents you added (each one's kind, name, picture and settings, and the one new chats start
 * with), from the account's (agent-sync.ts): what every device shares, and over it this device's
 * own fields (a CLI's path). Their secrets (a Hermes API key, an OpenClaw token) follow the account
 * too, except the ones that pair this device alone; they're in the platform's secrets under the
 * agent's id, never sent to the renderer, never logged.
 */

import {
  SELECTED_KEY,
  agentDeviceKey,
  agentKey,
  secretKey,
  type AgentMutation,
  type AgentRecord,
} from "@otter/contracts/agent-sync";

import { registeredAgents } from "../../extensions.js";
import { platform } from "../../platform.js";
import { deviceId, entries, entry, mutate } from "../agent-sync.js";
import { getOtterUser } from "../otter-account.js";
import type {
  AgentEntry,
  AgentId,
  AgentSecrets,
  AgentSettings,
  ProviderSettings,
} from "./types.js";

const deviceFields = (kind: string) =>
  (registeredAgents().get(kind)?.deviceFields ?? []) as readonly string[];

function split(kind: string, settings: Record<string, unknown>) {
  const own = deviceFields(kind);
  const shared: Record<string, unknown> = {};
  const device: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings))
    (own.includes(key) ? device : shared)[key] = value;
  return { shared, device };
}

/** No agents without an Otter account: they're the account's. */
export async function getProviderSettings(): Promise<ProviderSettings> {
  if (!getOtterUser()) return { selected: null, agents: [] };
  const device = deviceId();
  const agents = entries<AgentRecord>("agent/")
    .map(({ value }) => value)
    .sort((a, b) => a.addedAt - b.addedAt)
    .map(({ id, kind, name, avatar, settings }): AgentEntry => ({
      id,
      kind,
      name,
      ...(avatar && { avatar }),
      settings: {
        ...settings,
        ...entry<Record<string, unknown>>(agentDeviceKey(id, device)),
      } as AgentSettings,
    }));
  return { selected: entry<string>(SELECTED_KEY) ?? null, agents };
}

const changed = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(after).filter(([key, value]) => before[key] !== value));

/** Writes what differs from the agents as they are: each change its own mutation, so devices don't overwrite one another. */
export async function saveProviderSettings(next: ProviderSettings): Promise<void> {
  const current = await getProviderSettings();
  const device = deviceId();
  const mutations: AgentMutation[] = [];
  let addedAt = Math.max(0, ...entries<AgentRecord>("agent/").map(({ value }) => value.addedAt));
  for (const agent of next.agents) {
    const before = current.agents.find((a) => a.id === agent.id);
    const after = split(agent.kind, agent.settings);
    if (!before) {
      mutations.push({
        op: "agent.set",
        id: agent.id,
        kind: agent.kind,
        name: agent.name,
        ...(agent.avatar && { avatar: agent.avatar }),
        settings: after.shared,
        addedAt: ++addedAt,
      });
    } else {
      const prior = split(before.kind, before.settings);
      const settings = changed(prior.shared, after.shared);
      const avatar =
        (agent.avatar ?? null) === (before.avatar ?? null) ? undefined : (agent.avatar ?? null);
      if (agent.name !== before.name || avatar !== undefined || Object.keys(settings).length > 0)
        mutations.push({
          op: "agent.set",
          id: agent.id,
          kind: agent.kind,
          ...(agent.name !== before.name && { name: agent.name }),
          ...(avatar !== undefined && { avatar }),
          ...(Object.keys(settings).length > 0 && { settings }),
        });
      after.device = changed(prior.device, after.device);
    }
    if (Object.keys(after.device).length > 0)
      mutations.push({ op: "agent.device", id: agent.id, device, settings: after.device });
  }
  for (const agent of current.agents)
    if (!next.agents.some((a) => a.id === agent.id))
      mutations.push({ op: "agent.remove", id: agent.id });
  if (next.selected !== current.selected) mutations.push({ op: "select", id: next.selected });
  await mutate(mutations);
}

const secretName = (id: AgentId, name: string) => `agent:${id}:${name}`;

/** `deviceSecrets` stay on this device; the others are the account's, kept by the relay. */
export function agentSecrets(id: AgentId, deviceSecrets: readonly string[] = []): AgentSecrets {
  const own = (name: string) => deviceSecrets.includes(name);
  return {
    get: async (name) =>
      (await platform()
        .secrets.get(secretName(id, name))
        .catch(() => null)) ?? "",
    set: (name, value) =>
      own(name)
        ? platform().secrets.set(secretName(id, name), value)
        : mutate([{ op: "secret.set", agent: id, name, value }]),
    delete: async (name) => {
      if (own(name) || entry(secretKey(id, name)) == null)
        await platform().secrets.delete(secretName(id, name));
      else await mutate([{ op: "secret.set", agent: id, name, value: null }]);
    },
  };
}

/** Not removed: it may only be out of sight, without the account. */
export const agentExists = (id: AgentId) => entry(agentKey(id)) !== null;
