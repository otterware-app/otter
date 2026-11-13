import { demoAgents } from "@otter/contracts/demo";

import { callHandler } from "../ipc.js";
import { logger } from "../logger.js";
import { addAgent } from "./agent/service.js";
import { getProviderSettings } from "./agent/settings.js";

/**
 * Connects the demo run's local gateways, as their settings forms would: to the agent of each
 * kind it added on an earlier run, or a new one.
 */
export async function addDemoAgents(json: string): Promise<void> {
  const agents = demoAgents.parse(JSON.parse(json));
  const connections = [
    ["openclaw", "agent:connectOpenClaw", agents.openclaw],
    ["hermes", "agent:connectHermes", agents.hermes],
  ] as const;
  for (const [kind, channel, params] of connections) {
    if (!params) continue;
    const added = (await getProviderSettings()).agents.find((a) => a.kind === kind);
    const id = added?.id ?? (await addAgent(kind)).id;
    const outcome = await callHandler(channel, { ...params, agent: id });
    if ("error" in outcome) logger.warn("demo", `Couldn't connect ${kind}: ${outcome.error}`);
    else logger.info("demo", `Connected ${kind}`);
  }
}
