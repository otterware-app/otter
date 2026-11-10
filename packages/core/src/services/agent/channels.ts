/**
 * Agent channels: an agent tells the account's devices through Otter's relay that it has
 * something for the user (`POST <relay>/channel/v1/pointers`, with a channel's token). Each is
 * the account's, so it needs the Otter account.
 */

import type { AgentChannel } from "@otter/contracts/relay";
import { platform } from "../../platform.js";
import { relayRequest } from "../otter-account.js";

export async function agentChannels(): Promise<{ channels: AgentChannel[]; relayUrl: string }> {
  const { channels } = await relayRequest<{ channels: AgentChannel[] }>(
    "GET",
    "/v1/agent-channels",
  );
  return { channels, relayUrl: platform().relayUrl };
}

/** A new channel, with its token, shown only now. */
export async function makeAgentChannel(
  label: string,
): Promise<{ channel: AgentChannel; token: string; relayUrl: string }> {
  const made = await relayRequest<{ channel: AgentChannel; token: string }>(
    "POST",
    "/v1/agent-channels",
    { label },
  );
  return { ...made, relayUrl: platform().relayUrl };
}

export async function deleteAgentChannel(id: string): Promise<void> {
  await relayRequest("DELETE", `/v1/agent-channels/${encodeURIComponent(id)}`);
}
