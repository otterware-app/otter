/**
 * Agent settings (assistant-providers.json: the agent new chats start with,
 * then each agent's settings under its id) plus the Hermes API key and the
 * OpenClaw gateway token, which are full agent control: kept in the platform's
 * secrets, never sent to the renderer, never logged.
 */

import { readJson, writeJson } from "../../json-file.js";
import { platform } from "../../platform.js";
import { DEFAULT_AGENT, type AgentSettings, type ProviderSettings } from "./types.js";

type Stored = { selected?: string } & Record<string, unknown>;

let cache: ProviderSettings | null = null;
let unknown: Record<string, unknown> = {};

export async function getProviderSettings(
  defaults: () => Record<string, AgentSettings>,
): Promise<ProviderSettings> {
  if (cache) return cache;
  const { selected, ...stored } = (await readJson<Stored>("assistant-providers.json")) ?? {};
  const known = defaults();
  unknown = Object.fromEntries(Object.entries(stored).filter(([id]) => !(id in known)));
  cache = {
    selected: typeof selected === "string" ? selected : DEFAULT_AGENT,
    agents: Object.fromEntries(
      Object.entries(known).map(([id, base]) => [
        id,
        { ...base, ...(stored[id] as Partial<AgentSettings> | undefined) },
      ]),
    ),
  };
  return cache;
}

export async function saveProviderSettings(next: ProviderSettings): Promise<void> {
  cache = next;
  await writeJson("assistant-providers.json", {
    ...unknown,
    selected: next.selected,
    ...next.agents,
  });
}

// Stored under names from when agents were "assistants"; renaming them would lose them.
const HERMES_KEY_SECRET = "assistant-hermes-key";
const OPENCLAW_TOKEN_SECRET = "openclaw-gateway-token";
const OPENCLAW_BOOTSTRAP_SECRET = "openclaw-bootstrap-token";
const OPENCLAW_DEVICE_KEY_SECRET = "openclaw-device-key";
const OPENCLAW_DEVICE_TOKEN_SECRET = "openclaw-device-token";
// The Swift iPhone app's names, read once and moved on an upgrade in place.
const SWIFT_HERMES_KEY_SECRET = "hermes-key";
const SWIFT_OPENCLAW_TOKEN_SECRET = "openclaw-token";
const SWIFT_OPENCLAW_DEVICE_SCOPES_SECRET = "openclaw-device-scopes";

const secret = async (name: string): Promise<string> =>
  (await platform()
    .secrets.get(name)
    .catch(() => null)) ?? "";

async function movedSecret(name: string, from: string): Promise<string> {
  const value = await secret(name);
  if (value) return value;
  const old = await secret(from);
  if (!old) return "";
  await platform().secrets.set(name, old);
  await platform().secrets.delete(from);
  return old;
}

const deleteSecrets = async (...names: string[]) => {
  await Promise.all(names.map((name) => platform().secrets.delete(name)));
};

export const getHermesKey = () => movedSecret(HERMES_KEY_SECRET, SWIFT_HERMES_KEY_SECRET);

export async function setHermesKey(key: string): Promise<void> {
  await platform().secrets.set(HERMES_KEY_SECRET, key);
}

export async function clearHermesKey(): Promise<void> {
  await deleteSecrets(HERMES_KEY_SECRET, SWIFT_HERMES_KEY_SECRET);
}

export const getOpenClawToken = () =>
  movedSecret(OPENCLAW_TOKEN_SECRET, SWIFT_OPENCLAW_TOKEN_SECRET);
export const setOpenClawToken = (token: string) =>
  platform().secrets.set(OPENCLAW_TOKEN_SECRET, token);
export const clearOpenClawToken = () =>
  deleteSecrets(OPENCLAW_TOKEN_SECRET, SWIFT_OPENCLAW_TOKEN_SECRET);
export const getOpenClawBootstrapToken = () => secret(OPENCLAW_BOOTSTRAP_SECRET);
export const setOpenClawBootstrapToken = (token: string) =>
  platform().secrets.set(OPENCLAW_BOOTSTRAP_SECRET, token);
export const clearOpenClawBootstrapToken = () =>
  platform().secrets.delete(OPENCLAW_BOOTSTRAP_SECRET);
export const getOpenClawDeviceKey = () => secret(OPENCLAW_DEVICE_KEY_SECRET);
export const setOpenClawDeviceKey = (jwk: string) =>
  platform().secrets.set(OPENCLAW_DEVICE_KEY_SECRET, jwk);

/** `{ token, scopes }` as JSON. The Swift app kept the token bare, its scopes comma-separated beside it. */
export async function getOpenClawDeviceToken(): Promise<string> {
  const saved = await secret(OPENCLAW_DEVICE_TOKEN_SECRET);
  if (!saved || saved.startsWith("{")) return saved;
  const scopes = (await secret(SWIFT_OPENCLAW_DEVICE_SCOPES_SECRET)).split(",").filter(Boolean);
  const record = JSON.stringify({ token: saved, scopes });
  await platform().secrets.set(OPENCLAW_DEVICE_TOKEN_SECRET, record);
  await platform().secrets.delete(SWIFT_OPENCLAW_DEVICE_SCOPES_SECRET);
  return record;
}
export const setOpenClawDeviceToken = (record: string) =>
  platform().secrets.set(OPENCLAW_DEVICE_TOKEN_SECRET, record);
export const clearOpenClawDeviceToken = () =>
  deleteSecrets(OPENCLAW_DEVICE_TOKEN_SECRET, SWIFT_OPENCLAW_DEVICE_SCOPES_SECRET);
