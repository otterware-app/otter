import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_AGENT,
  mailApi,
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

export function useChatProvider(chat: { provider: ProviderKind; turns: unknown[] } | undefined) {
  const state = useAgentProviders().data;
  const selectedKind = state?.selected ?? DEFAULT_AGENT;
  const kind: ProviderKind = chat && chat.turns.length > 0 ? chat.provider : selectedKind;
  const provider = state?.providers.find((p) => p.kind === kind);
  const name =
    provider?.displayName ?? EXTENSIONS.find((e) => e.manifest.id === kind)?.manifest.name ?? kind;
  return { state, selectedKind, kind, provider, name, usable: isProviderUsable(provider) };
}

export type ChatProvider = ReturnType<typeof useChatProvider>;

export function useSetProvidersState() {
  const qc = useQueryClient();
  return (state: ProvidersState) => qc.setQueryData(PROVIDERS_KEY, state);
}

export function ProviderIcon({ kind, className }: { kind: ProviderKind; className?: string }) {
  const Icon = agentContribution(kind)?.Icon ?? BotIcon;
  return <Icon className={cn("size-4", className)} />;
}

export function openClawAgentId(sessionKey: string | null): string | null {
  return sessionKey?.match(/^agent:([^:]+):/)?.[1] ?? null;
}

export function AgentAvatar({
  kind,
  agent,
  className,
}: {
  kind?: ProviderKind;
  agent?: string | null;
  className?: string;
}) {
  const state = useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: () => mailApi.agentProviders(),
    staleTime: 30_000,
  }).data;
  const shown = kind ?? state?.selected ?? DEFAULT_AGENT;
  const provider = state?.providers.find((p) => p.kind === shown);
  const model = provider?.models.find((m) => m.slug === (agent ?? provider.model));
  const label = model?.avatar || model?.emoji ? model.name : provider?.displayName;
  const size = cn("size-4 shrink-0", className);
  if (model?.avatar)
    return (
      <img
        src={model.avatar}
        alt={label}
        title={label}
        className={cn(size, "rounded-full object-cover")}
      />
    );
  if (model?.emoji)
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(size, "flex items-center justify-center leading-none")}
      >
        {model.emoji}
      </span>
    );
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 opacity-80">
      <ProviderIcon kind={shown} className={className} />
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
      detail: `${p.displayName} is turned off for new chats.`,
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
