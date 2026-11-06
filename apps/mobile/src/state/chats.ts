import { makeChatsStore, type ChatsState } from "@otter-mail/client-runtime/state/chats";
import { useAtomValue } from "@effect/atom-react";
import { useSyncExternalStore } from "react";
import { Alert } from "react-native";

import { legacyDefaults } from "@otter-mail/mobile-background";

import { appAtomRegistry, clientPlatform } from "./client";
import { core } from "./core";
import { importSwiftOpenClaw } from "./swift-openclaw";

export type ModelOption = {
  id: "reasoningEffort" | "serviceTier";
  label: string;
  choices: { id: string; label: string; description?: string; isDefault?: boolean }[];
};

export type AgentModel = {
  slug: string;
  name: string;
  subProvider?: string;
  isDefault?: boolean;
  options?: ModelOption[];
};

/** An agent as core lists it (`agent:providers`): core's ProviderSnapshot. */
export type AgentProvider = {
  kind: string;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  status: "ready" | "warning" | "error" | "disabled";
  auth: { status: "authenticated" | "unauthenticated" | "unknown" };
  checkedAt: number | null;
  message?: string;
  models: AgentModel[];
  model: string | null;
  sessions: boolean;
  settings: {
    enabled: boolean;
    model: string;
    reasoningEffort?: string;
    serviceTier?: string;
    runtimeMode?: RuntimeMode;
  } & Record<string, unknown>;
};

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export type ProvidersState = { providers: AgentProvider[]; selected: string };

export const isProviderUsable = (p: AgentProvider | undefined): boolean =>
  Boolean(p && p.enabled && p.status !== "error" && (p.installed || p.checkedAt === null));

/** The agent's chats: client-runtime's store, the same the web app runs, synced through core. */
export const chats = makeChatsStore<AgentProvider>(appAtomRegistry, {
  core,
  platform: clientPlatform,
  providerName: (kind) => agents.get().providers.find((p) => p.kind === kind)?.displayName ?? kind,
  isProviderUsable,
  isFileLink: () => false,
  mergeChanges: (changes) => changes,
  closeChatPages: () => {},
  showError: (title, description) => Alert.alert(title, description),
  log: (event, data) => console.log(`[chats:${event}]`, data ? JSON.stringify(data) : ""),
});

export function useChats<T>(select: (state: ChatsState) => T): T {
  return useAtomValue(chats.stateAtom, select);
}

/** The agents and their state, following `agent:providersChanged`. */
export const agents = (() => {
  let state: ProvidersState = { providers: [], selected: "" };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: ProvidersState) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
})();

/** Saves agent settings (`{ selected, [kind]: { model, … } }`), as the web's updateSettings. */
export async function updateAgentSettings(patch: Record<string, unknown>): Promise<void> {
  agents.set(await core.invoke<ProvidersState>("agent:updateSettings", patch));
}

/**
 * From launch: the agents, and the chats following them, so what an agent
 * delivers becomes its chat and notifies while the app shows mail.
 */
export function startAgents(): () => void {
  const offs = [
    core.on("agent:providersChanged", (state) => agents.set(state as ProvidersState)),
    chats.start(),
  ];
  void core.invoke<ProvidersState>("agent:providers").then(agents.set, () => {});
  void importSwiftOpenClaw({
    storage: clientPlatform.storage,
    read: legacyDefaults,
    invoke: (channel, params) => core.invoke(channel, params),
  }).catch((error: unknown) => console.log(`[agents] Swift import failed: ${String(error)}`));
  let unfollow: (() => void) | undefined;
  let followed: AgentProvider[] = [];
  const follow = () => {
    const { providers } = agents.get();
    if (providers === followed || providers.length === 0) return;
    followed = providers;
    unfollow?.();
    unfollow = chats.followProviders(providers);
  };
  offs.push(agents.subscribe(follow));
  return () => {
    unfollow?.();
    for (const off of offs) off();
  };
}

export function useAgents(): ProvidersState {
  return useSyncExternalStore(agents.subscribe, agents.get);
}

export function useAgentProviders(): AgentProvider[] {
  return useAgents().providers;
}

/** The agent a new chat uses: the one chosen in Settings when it's usable, else the first that is. */
export function defaultAgent({ providers, selected }: ProvidersState): AgentProvider | undefined {
  const chosen = providers.find((p) => p.kind === selected);
  return isProviderUsable(chosen) ? chosen : (providers.find(isProviderUsable) ?? chosen);
}
