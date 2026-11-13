import type { ExtensionManifest } from "@otter/contracts/extensions";

import { handle, registeredHandlers, unhandle, type Handler } from "./ipc.js";
import { logger } from "./logger.js";
import type { AgentSettings, AgentType } from "./services/agent/types.js";

export type ExtensionContext = {
  readonly manifest: ExtensionManifest;
  handle(channel: string, handler: Handler): void;
  registerAgent<S extends AgentSettings>(agent: AgentType<S>): void;
};

export type CoreExtension = {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): void | Promise<void>;
};

const agents = new Map<string, AgentType>();

/**
 * Activates each extension in order. One that fails is left out: what it
 * registered before failing is dropped, and the rest still run. A channel or
 * agent can't be taken twice.
 */
export async function activateExtensions(extensions: readonly CoreExtension[]): Promise<void> {
  for (const { manifest, activate } of extensions) {
    const channels: string[] = [];
    let agent: string | null = null;
    const context: ExtensionContext = {
      manifest,
      handle(channel, handler) {
        if (registeredHandlers().has(channel))
          throw new Error(`${manifest.id}: the channel ${channel} is already taken.`);
        handle(channel, handler);
        channels.push(channel);
      },
      registerAgent(type) {
        if (type.kind !== manifest.id)
          throw new Error(`${manifest.id} can only contribute the agent "${manifest.id}".`);
        if (agents.has(type.kind))
          throw new Error(`${manifest.id}: the agent ${type.kind} is already registered.`);
        agents.set(type.kind, type as unknown as AgentType);
        agent = type.kind;
      },
    };
    try {
      await activate(context);
    } catch (error) {
      for (const channel of channels) unhandle(channel);
      if (agent) agents.delete(agent);
      logger.error("extensions", `${manifest.id} didn't activate`, error);
    }
  }
}

/** The kinds of agent this backend runs, by kind. */
export function registeredAgents(): ReadonlyMap<string, AgentType> {
  return agents;
}
