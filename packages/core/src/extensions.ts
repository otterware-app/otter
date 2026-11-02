import type { ExtensionManifest } from "@otter-mail/contracts/extensions";

import { handle, registeredHandlers, unhandle, type Handler } from "./ipc.js";
import { logger } from "./logger.js";
import type { AgentSettings, ChatProvider } from "./services/agent/types.js";

export type ExtensionContext = {
  readonly manifest: ExtensionManifest;
  handle(channel: string, handler: Handler): void;
  registerAgent<S extends AgentSettings>(agent: ChatProvider<S>): void;
};

export type CoreExtension = {
  manifest: ExtensionManifest;
  activate(context: ExtensionContext): void | Promise<void>;
};

const agents = new Map<string, ChatProvider>();

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
      registerAgent(provider) {
        if (provider.kind !== manifest.id)
          throw new Error(`${manifest.id} can only contribute the agent "${manifest.id}".`);
        if (agents.has(provider.kind))
          throw new Error(`${manifest.id}: the agent ${provider.kind} is already registered.`);
        agents.set(provider.kind, provider as unknown as ChatProvider);
        agent = provider.kind;
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

export function registeredAgents(): ReadonlyMap<string, ChatProvider> {
  return agents;
}
