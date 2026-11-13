/**
 * Messages from varys while Otter is closed: this device's grant names Otter's relay
 * (`varys.relay.set`), with the token of an agent channel of the account's made for it, and
 * varys tells the relay which thread to read, never what's in it. The account's devices then
 * catch up (`ChatProvider.delivered`). It needs the Otter account; without one, varys is
 * followed only while Otter is open.
 */

import type { Varys } from "@generalpursuit/varys";
import {
  deleteAgentChannel,
  getOtterUser,
  logger,
  makeAgentChannel,
  saveAgentSettings,
  type AgentId,
} from "@otter/core/extension-kit";

import type { VarysSettings } from "./settings.js";

/** Names this device's grant a channel of the account's; nothing without the Otter account. */
export async function registerRelay(agent: AgentId, varys: Varys, name: string): Promise<void> {
  if (!getOtterUser()) return;
  const { channel, token, relayUrl } = await makeAgentChannel(`varys · ${name}`);
  const set = await varys.relay.set({ address: relayUrl, token });
  if (set.isErr()) {
    await deleteAgentChannel(channel.id).catch(() => {});
    throw new Error(set.error.message);
  }
  await saveAgentSettings(agent, { relayChannel: channel.id });
  logger.info("agent", "varys relay set", { address: set.value.address });
}

/** Stops varys telling the relay, and deletes the channel; each is done as far as it can be. */
export async function removeRelay(
  agent: AgentId,
  varys: Varys | null,
  settings: VarysSettings,
): Promise<void> {
  const removed = await varys?.relay.remove();
  if (removed?.isErr())
    logger.info("agent", "varys relay not removed", { code: removed.error.code });
  if (!settings.relayChannel) return;
  await deleteAgentChannel(settings.relayChannel).catch((error: unknown) =>
    logger.info("agent", "varys channel not deleted", { error: String(error) }),
  );
  await saveAgentSettings(agent, { relayChannel: "" });
}

/**
 * Ends this device's grant in varys, which takes its relay with it, and deletes the channel.
 * False when varys couldn't be asked; a grant that's gone already is as good as ended.
 */
export async function revokeGrant(
  agent: AgentId,
  varys: Varys | null,
  settings: VarysSettings,
): Promise<boolean> {
  const revoked = await varys?.revoke();
  const failure = revoked?.isErr() && revoked.error.code !== "UNAUTHORIZED" ? revoked.error : null;
  if (failure) logger.info("agent", "varys grant not revoked", { code: failure.code });
  await removeRelay(agent, null, settings);
  return !failure;
}
