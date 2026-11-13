import { pair } from "@generalpursuit/varys";
import {
  agentProvider,
  agentSettings,
  getOtterUser,
  logger,
  onOtterAccountChange,
  platform,
  providersState,
  refreshProvider,
  saveAgentSettings,
  type AgentId,
  type CoreExtension,
} from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { registerRelay, removeRelay, revokeGrant } from "./relay.js";
import type { VarysSettings } from "./settings.js";
import { varysAgent, type VarysProvider } from "./varys.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The agent a call is for, by its id. */
function agentOf(params: unknown): AgentId {
  const agent = str((params as Record<string, unknown> | undefined)?.agent);
  if (!agent) throw new Error("Choose an agent.");
  return agent;
}

const providerOf = async (agent: AgentId) => (await agentProvider(agent)) as VarysProvider;
const settingsNow = async (agent: AgentId) => (await agentSettings(agent)) as VarysSettings;

/** How the grant is listed in varys's Settings → Sharing & access. */
function appName(): string {
  const { kind, deviceName } = platform();
  if (kind === "web") return "Otter on the web";
  return deviceName ? `Otter on ${deviceName}` : "Otter";
}

/** This device's grant tells Otter's relay while the Otter account is signed in, and not after. */
async function syncRelay(agent: AgentId): Promise<void> {
  const settings = await settingsNow(agent);
  const varys = await (await providerOf(agent)).client(settings).catch(() => null);
  if (!varys) return;
  if (getOtterUser() && !settings.relayChannel) await registerRelay(agent, varys, appName());
  else if (!getOtterUser() && settings.relayChannel) await removeRelay(agent, varys, settings);
}

const relayFailed = (error: unknown) =>
  logger.info("agent", "varys relay failed", { error: String(error) });

async function syncRelays(): Promise<void> {
  const { providers } = await providersState();
  for (const { id, kind } of providers)
    if (kind === varysAgent.kind) await syncRelay(id).catch(relayFailed);
}

/**
 * Trades varys's app code for this device's grant. Pairing again (a new code) replaces the
 * grant this device had, as it pairs as the same installation.
 */
async function connect(agent: AgentId, code: { link: string } | { address: string; code: string }) {
  const settings = await settingsNow(agent);
  const installation = settings.installation || crypto.randomUUID();
  const paired = await pair({ ...code, name: appName(), installation });
  if (paired.isErr()) throw new Error(paired.error.message);
  const { address, agentId, token, grant } = paired.value;
  // The grant it replaces took its relay with it; the channel goes too.
  await removeRelay(agent, null, settings);
  await (await providerOf(agent)).grant(token);
  await saveAgentSettings(agent, { address, agentId, installation });
  logger.info("agent", "varys paired", { address, actsAs: grant.actsAs, scopes: grant.scopes });
  await syncRelay(agent).catch(relayFailed);
  void refreshProvider(agent);
  return providersState();
}

/**
 * Ends this device's grant in varys and forgets it here. One varys couldn't be asked to end is
 * forgotten here all the same, and the owner told to remove it in varys.
 */
async function disconnect(agent: AgentId) {
  const settings = await settingsNow(agent);
  const provider = await providerOf(agent);
  const revoked = await revokeGrant(
    agent,
    await provider.client(settings).catch(() => null),
    settings,
  );
  await provider.grant(null);
  await saveAgentSettings(agent, { address: "", agentId: "" });
  void refreshProvider(agent);
  return {
    state: await providersState(),
    ...(!revoked && {
      notice: `Disconnected here, but varys couldn't be reached: remove “${appName()}” in varys's Sharing & access.`,
    }),
  };
}

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(varysAgent);
    onOtterAccountChange(() => void syncRelays());
    handle("agent:connectVarys", async (params: unknown) => {
      const agent = agentOf(params);
      const p = params as Record<string, unknown>;
      const link = str(p.link);
      if (link) return connect(agent, { link });
      const address = str(p.address);
      const code = str(p.code);
      if (!address || !code)
        throw new Error("Paste the pairing link, or varys's address and code.");
      return connect(agent, { address, code });
    });
    handle("agent:disconnectVarys", (params: unknown) => disconnect(agentOf(params)));
    handle("agent:varysRelay", async (params: unknown) => {
      await syncRelay(agentOf(params));
      return providersState();
    });
  },
} satisfies CoreExtension;
