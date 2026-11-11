import { demoAgents } from "@otter/contracts/demo";

import { callHandler } from "../ipc.js";
import { logger } from "../logger.js";

/** Connects the app to the demo run's local gateways, as their settings forms would. */
export async function addDemoAgents(json: string): Promise<void> {
  const agents = demoAgents.parse(JSON.parse(json));
  const connections = [
    ["OpenClaw", "agent:connectOpenClaw", agents.openclaw],
    ["Hermes", "agent:connectHermes", agents.hermes],
  ] as const;
  await Promise.all(
    connections.map(async ([name, channel, params]) => {
      if (!params) return;
      const outcome = await callHandler(channel, params);
      if ("error" in outcome) logger.warn("demo", `Couldn't connect ${name}: ${outcome.error}`);
      else logger.info("demo", `Connected ${name}`);
    }),
  );
}
