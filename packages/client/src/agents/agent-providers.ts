import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "../bridge.ts";
import type { AgentTraits } from "./agent-traits.ts";
import { agentApi, type AgentId, type ProviderSnapshot, type ProvidersState } from "./api.ts";

export const PROVIDERS_KEY = ["agent-providers"] as const;

export function useAgentProviders() {
  const qc = useQueryClient();
  useEffect(
    () =>
      listen("agent:providersChanged", (state: unknown) =>
        qc.setQueryData(PROVIDERS_KEY, state as ProvidersState),
      ),
    [qc],
  );
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => agentApi.providers(),
    staleTime: 30_000,
  });
}

/** The agent a chat runs on: its own once it has started, else the one new chats start with. */
export function useChatProvider(chat: { provider: AgentId; turns: unknown[] } | undefined) {
  const state = useAgentProviders().data;
  const selectedId = state?.selected ?? null;
  const id: AgentId | null = chat && chat.turns.length > 0 ? chat.provider : selectedId;
  const provider = state?.providers.find((p) => p.id === id);
  const name = provider?.name ?? state?.others.find((o) => o.id === id)?.name ?? "Agent";
  return { state, selectedId, id, provider, name, usable: isProviderUsable(provider) };
}

export type ChatProvider = ReturnType<typeof useChatProvider>;

export function useSetProvidersState() {
  const qc = useQueryClient();
  return (state: ProvidersState) => qc.setQueryData(PROVIDERS_KEY, state);
}

export function openClawAgentId(sessionKey: string | null): string | null {
  return sessionKey?.match(/^agent:([^:]+):/)?.[1] ?? null;
}

export function providerVersionLabel(version: string | null): string | null {
  if (!version) return null;
  return /^\d+\.\d+/.test(version) ? `v${version}` : version;
}

/** `kind`: what the agent's kind says of itself. */
export function providerSummary(
  p: ProviderSnapshot | undefined,
  kind: Pick<AgentTraits, "missing" | "connectedAs"> | undefined,
): {
  headline: string;
  detail?: string;
} {
  if (!p || (p.checkedAt === null && p.enabled))
    return {
      headline: "Checking provider status",
      detail: "Waiting for installation and authentication details.",
    };
  if (!p.enabled || p.status === "disabled")
    return {
      headline: "Disabled",
      detail: `${p.name} is turned off for new chats.`,
    };
  if (!p.installed)
    return {
      headline: kind?.missing.headline ?? "Not found",
      detail: p.message ?? kind?.missing.detail,
    };
  if (p.auth.status === "unauthenticated")
    return { headline: "Not authenticated", detail: p.message };
  if (p.status === "warning")
    return {
      headline: "Needs attention",
      detail: p.message ?? "The provider could not be fully verified.",
    };
  if (p.status === "error")
    return {
      headline: "Unavailable",
      detail: p.message ?? "The provider failed its startup checks.",
    };
  if (p.auth.status === "authenticated" && kind?.connectedAs && p.auth.label)
    return { headline: `Connected as ${p.auth.label}`, detail: p.message };
  if (p.auth.status === "authenticated")
    return {
      headline: p.auth.label ? `Authenticated · ${p.auth.label}` : "Authenticated",
      detail: p.message,
    };
  return { headline: "Available", detail: p.message };
}

export function isProviderUsable(p: ProviderSnapshot | undefined): boolean {
  return Boolean(p && p.enabled && p.status !== "error" && (p.installed || p.checkedAt === null));
}

/** A gateway's agents you turned off (OpenClaw's `disabledAgents`): still named, never run. */
export function disabledAgents(p: ProviderSnapshot): string[] {
  const off = p.settings.disabledAgents;
  return Array.isArray(off) ? off.filter((id): id is string => typeof id === "string") : [];
}

/** Its models, or for a gateway the agents it runs that are on. */
export const enabledModels = (p: ProviderSnapshot) =>
  p.models.filter((m) => !disabledAgents(p).includes(m.slug));

/** The gateway's agent a new chat starts on: the one chosen while it's on, else the default, else the first on. */
export function startingModel(p: ProviderSnapshot): string | null {
  const on = enabledModels(p);
  return (on.find((m) => m.slug === p.model) ?? on.find((m) => m.isDefault) ?? on[0])?.slug ?? null;
}

/** Whether a new chat can start on it: a gateway needs one of its agents on. */
export const canStartChat = (p: ProviderSnapshot) =>
  p.models.length === 0 ? !disabledAgents(p).includes("main") : enabledModels(p).length > 0;

/** Whether a chat can run on its agent now: the agent works here and, for a gateway, the chat's agent there is on. */
export function canRunChat(p: ProviderSnapshot | undefined, sessionId: string | null): boolean {
  if (!p || !isProviderUsable(p)) return false;
  const agent = openClawAgentId(sessionId);
  return agent ? !disabledAgents(p).includes(agent) : canStartChat(p);
}

/** The kinds of agent, as a sentence offers them: "Hermes, OpenClaw or varys". */
export function kindList(kinds: { name: string }[]): string {
  const names = kinds.map((k) => k.name);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
    : (names[0] ?? "an agent");
}

/**
 * An agent as it shows itself: one of a gateway's agents (`agent`, else its default) with its
 * own picture or emoji, else the picture you gave the agent; neither, its kind's mark.
 */
export function agentFace(
  provider: ProviderSnapshot | undefined,
  agent?: string | null,
): { label: string; picture: string | null; emoji: string | null } {
  const model = provider?.models.find((m) => m.slug === (agent ?? provider.model));
  const own = model?.avatar || model?.emoji ? model : undefined;
  return {
    label: own?.name ?? (agent ? model?.name : undefined) ?? provider?.name ?? "Agent",
    picture: own?.avatar ?? (own?.emoji ? null : (provider?.avatar ?? null)),
    emoji: own?.emoji ?? null,
  };
}
