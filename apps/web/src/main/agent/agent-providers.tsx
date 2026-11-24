import { useQuery } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { EXTENSIONS, agentContribution } from "../extensions/registry";
import { cn } from "@otter/ui/lib/utils";
import {
  agentApi,
  type AgentId,
  type ProviderKind,
  type ProviderSnapshot,
} from "@otter/client/agents/api";
import {
  PROVIDERS_KEY,
  agentFace,
  providerSummary as summarize,
} from "@otter/client/agents/agent-providers";

/** A kind of agent's mark (Hermes's, OpenClaw's…). */
export function ProviderIcon({ kind, className }: { kind: ProviderKind; className?: string }) {
  const Icon = agentContribution(kind)?.Icon ?? BotIcon;
  return <Icon className={cn("size-4", className)} />;
}

export const kindName = (kind: ProviderKind) =>
  EXTENSIONS.find((e) => e.manifest.id === kind)?.manifest.name ?? kind;

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
    queryFn: () => agentApi.providers(),
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
  const { label, picture, emoji } = agentFace(provider, agent);
  const size = cn("size-4 shrink-0", className);
  if (picture)
    return (
      <img
        src={picture}
        alt={label}
        title={label}
        className={cn(size, "rounded-full object-cover")}
      />
    );
  if (emoji)
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn(size, "flex items-center justify-center leading-none")}
      >
        {emoji}
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

export const providerSummary = (p: ProviderSnapshot | undefined) =>
  summarize(p, p && agentContribution(p.kind));
