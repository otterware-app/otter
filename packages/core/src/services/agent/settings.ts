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
/** Agents this file holds settings for whose extension isn't here: kept as they were. */
let unknown: Record<string, unknown> = {};

/** Every registered agent's settings, its defaults filled in. */
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
/** A setup code's one-time bootstrap token (`openclaw qr`), until the gateway issues a device token. */
const OPENCLAW_BOOTSTRAP_SECRET = "openclaw-bootstrap-token";
/** This device's Ed25519 key (JWK) and the device token the gateway issued it. */
const OPENCLAW_DEVICE_KEY_SECRET = "openclaw-device-key";
const OPENCLAW_DEVICE_TOKEN_SECRET = "openclaw-device-token";

export async function getHermesKey(): Promise<string> {
  return (
    (await platform()
      .secrets.get(HERMES_KEY_SECRET)
      .catch(() => null)) ?? ""
  );
}

export async function setHermesKey(key: string): Promise<void> {
  await platform().secrets.set(HERMES_KEY_SECRET, key);
}

export async function clearHermesKey(): Promise<void> {
  await platform().secrets.delete(HERMES_KEY_SECRET);
}

const secret = async (name: string): Promise<string> =>
  (await platform()
    .secrets.get(name)
    .catch(() => null)) ?? "";

export const getOpenClawToken = () => secret(OPENCLAW_TOKEN_SECRET);
export const setOpenClawToken = (token: string) =>
  platform().secrets.set(OPENCLAW_TOKEN_SECRET, token);
export const clearOpenClawToken = () => platform().secrets.delete(OPENCLAW_TOKEN_SECRET);
export const getOpenClawBootstrapToken = () => secret(OPENCLAW_BOOTSTRAP_SECRET);
export const setOpenClawBootstrapToken = (token: string) =>
  platform().secrets.set(OPENCLAW_BOOTSTRAP_SECRET, token);
export const clearOpenClawBootstrapToken = () =>
  platform().secrets.delete(OPENCLAW_BOOTSTRAP_SECRET);
export const getOpenClawDeviceKey = () => secret(OPENCLAW_DEVICE_KEY_SECRET);
export const setOpenClawDeviceKey = (jwk: string) =>
  platform().secrets.set(OPENCLAW_DEVICE_KEY_SECRET, jwk);
export const getOpenClawDeviceToken = () => secret(OPENCLAW_DEVICE_TOKEN_SECRET);
export const setOpenClawDeviceToken = (record: string) =>
  platform().secrets.set(OPENCLAW_DEVICE_TOKEN_SECRET, record);
export const clearOpenClawDeviceToken = () =>
  platform().secrets.delete(OPENCLAW_DEVICE_TOKEN_SECRET);
