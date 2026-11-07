import { makeChatsStore, type ChatsState } from "@otter-mail/client-runtime/state/chats";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { Alert } from "react-native";

import { appAtomRegistry, clientPlatform } from "./client";
import { core } from "./core";

/** An agent as core lists it (`agent:providers`). */
export type AgentProvider = {
  kind: string;
  displayName: string;
  enabled: boolean;
  installed: boolean;
  status: string;
  auth: { status: "authenticated" | "unauthenticated" | "unknown" };
  checkedAt: number | null;
  message?: string;
};

type ProvidersState = { providers: AgentProvider[] };

export const isProviderUsable = (p: AgentProvider | undefined): boolean =>
  Boolean(p && p.enabled && p.status !== "error" && (p.installed || p.checkedAt === null));

/** The agent's chats: client-runtime's store, the same the web app runs, synced through core. */
export const chats = makeChatsStore<AgentProvider>(appAtomRegistry, {
  core,
  platform: clientPlatform,
  providerName: (kind) => providerNames.get(kind) ?? kind,
  isProviderUsable,
  isFileLink: () => false,
  mergeChanges: (changes) => changes,
  closeChatPages: () => {},
  showError: (title, description) => Alert.alert(title, description),
  log: (event, data) => console.log(`[chats:${event}]`, data ? JSON.stringify(data) : ""),
});

const providerNames = new Map<string, string>();

export function useChats<T>(select: (state: ChatsState) => T): T {
  return useAtomValue(chats.stateAtom, select);
}

/** The agents and their state, following `agent:providersChanged`; starts the chats once seen. */
export function useAgentProviders(): AgentProvider[] {
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  useEffect(() => {
    const take = (state: ProvidersState) => {
      for (const p of state.providers) providerNames.set(p.kind, p.displayName);
      setProviders(state.providers);
    };
    void core.invoke<ProvidersState>("agent:providers").then(take, () => {});
    return core.on("agent:providersChanged", (state) => take(state as ProvidersState));
  }, []);
  useEffect(() => chats.start(), []);
  useEffect(
    () => (providers.length > 0 ? chats.followProviders(providers) : undefined),
    [providers],
  );
  return providers;
}
