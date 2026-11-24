import { demoAgents } from "@otter/contracts/demo";

import { callHandler } from "../ipc.ts";
import { logger } from "../logger.ts";
import { syncAgentData } from "./agent-sync.ts";
import { addAgent } from "./agent/service.ts";
import { getProviderSettings } from "./agent/settings.ts";

/**
 * Connects the demo run's local gateways, as their settings forms would: to the agent of each
 * kind it added on an earlier run, or a new one. One already set to the gateway is left alone.
 */
export async function addDemoAgents(json: string): Promise<void> {
  const agents = demoAgents.parse(JSON.parse(json));
  if (!agents.openclaw && !agents.hermes) return;
  // A new device has no copy of the account's agents yet.
  await syncAgentData();
  const connections = [
    ["openclaw", "agent:connectOpenClaw", agents.openclaw],
    ["hermes", "agent:connectHermes", agents.hermes],
  ] as const;
  for (const [kind, channel, params] of connections) {
    if (!params) continue;
    const added = (await getProviderSettings()).agents.find((a) => a.kind === kind);
    // Connecting again would drop a turn the agent is resuming.
    const settings = added?.settings as { url?: unknown; baseUrl?: unknown } | undefined;
    if (
      "url" in params ? settings?.url === params.url : settings?.baseUrl === `${params.baseUrl}/v1`
    )
      continue;
    const id = added?.id ?? (await addAgent(kind)).id;
    const outcome = await callHandler(channel, { ...params, agent: id });
    if ("error" in outcome) logger.warn("demo", `Couldn't connect ${kind}: ${outcome.error}`);
    else logger.info("demo", `Connected ${kind}`);
  }
}
