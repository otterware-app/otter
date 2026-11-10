import { pair } from "@generalpursuit/varys";
import {
  agentSettings,
  getOtterUser,
  logger,
  onOtterAccountChange,
  platform,
  providersState,
  refreshProvider,
  saveAgentSettings,
  type CoreExtension,
} from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import { varysClient } from "./client.js";
import { registerRelay, removeRelay, revokeGrant } from "./relay.js";
import type { VarysSettings } from "./settings.js";
import { clearVarysToken, setVarysToken } from "./token.js";
import { varysProvider } from "./varys.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const settingsNow = async () => (await agentSettings("varys")) as VarysSettings;

/** How the grant is listed in varys's Settings → Sharing & access. */
function appName(): string {
  const { kind, deviceName } = platform();
  if (kind === "web") return "Otter on the web";
  return deviceName ? `Otter on ${deviceName}` : "Otter";
}

/** This device's grant tells Otter's relay while the Otter account is signed in, and not after. */
async function syncRelay(): Promise<void> {
  const settings = await settingsNow();
  const varys = await varysClient(settings).catch(() => null);
  if (!varys) return;
  if (getOtterUser() && !settings.relayChannel) await registerRelay(varys, appName());
  else if (!getOtterUser() && settings.relayChannel) await removeRelay(varys, settings);
}

const relayFailed = (error: unknown) =>
  logger.info("agent", "varys relay failed", { error: String(error) });

/**
 * Trades varys's app code for this device's grant. Pairing again (a new code) replaces the
 * grant this device had, as it pairs as the same installation.
 */
async function connect(code: { link: string } | { address: string; code: string }) {
  const settings = await settingsNow();
  const installation = settings.installation || crypto.randomUUID();
  const paired = await pair({ ...code, name: appName(), installation });
  if (paired.isErr()) throw new Error(paired.error.message);
  const { address, agentId, token, grant } = paired.value;
  // The grant it replaces took its relay with it; the channel goes too.
  await removeRelay(null, settings);
  varysProvider.shutdown();
  await setVarysToken(token);
  await saveAgentSettings("varys", { address, agentId, installation });
  logger.info("agent", "varys paired", { address, actsAs: grant.actsAs, scopes: grant.scopes });
  await syncRelay().catch(relayFailed);
  void refreshProvider("varys");
  return providersState();
}

/**
 * Ends this device's grant in varys and forgets it here. One varys couldn't be asked to end is
 * forgotten here all the same, and the owner told to remove it in varys.
 */
async function disconnect() {
  const settings = await settingsNow();
  const revoked = await revokeGrant(await varysClient(settings).catch(() => null), settings);
  varysProvider.shutdown();
  await clearVarysToken();
  await saveAgentSettings("varys", { address: "", agentId: "" });
  void refreshProvider("varys");
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
    registerAgent(varysProvider);
    onOtterAccountChange(() => void syncRelay().catch(relayFailed));
    handle("agent:connectVarys", async (params: unknown) => {
      const p = params as Record<string, unknown> | undefined;
      const link = str(p?.link);
      if (link) return connect({ link });
      const address = str(p?.address);
      const code = str(p?.code);
      if (!address || !code)
        throw new Error("Paste the pairing link, or varys's address and code.");
      return connect({ address, code });
    });
    handle("agent:disconnectVarys", disconnect);
    handle("agent:varysRelay", async () => {
      await syncRelay();
      return providersState();
    });
  },
} satisfies CoreExtension;
