import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  mailApi,
  type AgentId,
  type ProviderKind,
  type ProviderSnapshot,
  type ProvidersState,
} from "../mail/api";
import { cn } from "../mail/ui";
import { BotIcon } from "lucide-react";
import { EXTENSIONS, agentContribution } from "../extensions/registry";

const PROVIDERS_KEY = ["agent-providers"] as const;

export function useAgentProviders() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on("agent:providersChanged", (state: unknown) =>
        qc.setQueryData(PROVIDERS_KEY, state as ProvidersState),
      ),
    [qc],
  );
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => mailApi.agentProviders(),
    staleTime: 30_000,
  });
}

/** The agent a chat runs on: its own once it has started, else the one new chats start with. */
export function useChatProvider(chat: { provider: AgentId; turns: unknown[] } | undefined) {
  const state = useAgentProviders().data;
  const selectedId = state?.selected ?? null;
  const id: AgentId | null = chat && chat.turns.length > 0 ? chat.provider : selectedId;
  const provider = state?.providers.find((p) => p.id === id);
  const name = provider?.name ?? "Agent";
  return { state, selectedId, id, provider, name, usable: isProviderUsable(provider) };
}

export type ChatProvider = ReturnType<typeof useChatProvider>;

export function useSetProvidersState() {
  const qc = useQueryClient();
  return (state: ProvidersState) => qc.setQueryData(PROVIDERS_KEY, state);
}

/** A kind of agent's mark (Hermes's, OpenClaw's…). */
export function ProviderIcon({ kind, className }: { kind: ProviderKind; className?: string }) {
  const Icon = agentContribution(kind)?.Icon ?? BotIcon;
  return <Icon className={cn("size-4", className)} />;
}

export const kindName = (kind: ProviderKind) =>
  EXTENSIONS.find((e) => e.manifest.id === kind)?.manifest.name ?? kind;

export function openClawAgentId(sessionKey: string | null): string | null {
  return sessionKey?.match(/^agent:([^:]+):/)?.[1] ?? null;
}

/**
 * An agent as it shows itself: one of an OpenClaw gateway's agents (`agent`, else its default)
 * with its own picture or emoji, else the picture you gave the agent, else its kind's mark. `id` is the agent's; absent,
 * the one new chats start with.
 */
export function AgentAvatar({
  id,
  agent,
  className,
}: {
  id?: AgentId | null;
  agent?: string | null;
  className?: string;
}) {
  const state = useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => mailApi.agentProviders(),
    staleTime: 30_000,
  }).data;
  const provider = state?.providers.find((p) => p.id === (id ?? state.selected));
  return <AgentFace provider={provider} agent={agent} className={className} />;
}

export function AgentFace({
  provider,
  agent,
  className,
}: {
  provider: ProviderSnapshot | undefined;
  agent?: string | null;
  className?: string;
}) {
  const model = provider?.models.find((m) => m.slug === (agent ?? provider.model));
  const own = model?.avatar || model?.emoji ? model : undefined;
  const label = own?.name ?? (agent ? model?.name : undefined) ?? provider?.name ?? "Agent";
  const size = cn("size-4 shrink-0", className);
  const picture = own?.avatar ?? (own?.emoji ? null : provider?.avatar);
  if (picture)
    return (
      <img
        src={picture}
        alt={label}
        title={label}
        className={cn(size, "rounded-full object-cover")}
      />
    );
  if (own?.emoji)
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(size, "flex items-center justify-center leading-none")}
      >
        {own.emoji}
      </span>
    );
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 opacity-80">
      <ProviderIcon kind={provider?.kind ?? ""} className={className} />
    </span>
  );
}

export const PROVIDER_STATUS_DOT: Record<ProviderSnapshot["status"], string> = {
  disabled: "bg-muted-foreground/50",
  error: "bg-destructive",
  ready: "bg-success",
  warning: "bg-warning",
};

export function providerVersionLabel(version: string | null): string | null {
  if (!version) return null;
  return /^\d+\.\d+/.test(version) ? `v${version}` : version;
}

export function providerSummary(p: ProviderSnapshot | undefined): {
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
      headline: agentContribution(p.kind)?.missing.headline ?? "Not found",
      detail: p.message ?? agentContribution(p.kind)?.missing.detail,
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
  if (p.auth.status === "authenticated" && agentContribution(p.kind)?.connectedAs && p.auth.label)
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
