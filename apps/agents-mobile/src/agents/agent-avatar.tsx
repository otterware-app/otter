import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { Avatar } from "@otter/ui-native/components/avatar";
import { useTheme } from "@otter/ui-native/theme";

import { OtterMark } from "./otter-mark.tsx";
import { agentMark } from "./registry.ts";

/**
 * An agent's picture (Design.swift's `AgentAvatar`): the face of the gateway's agent a chat runs
 * on (an OpenClaw agent's picture or emoji), else the picture you gave the agent, else its
 * kind's mark, else Otter's.
 */
export function AgentAvatar({
  agent,
  gatewayAgent,
  kind,
  size = 20,
}: {
  /** The agent's id. */
  agent?: string | null;
  /** Which of an OpenClaw gateway's agents. */
  gatewayAgent?: string | null;
  /** A kind's mark, for no agent in particular. */
  kind?: string;
  size?: number;
}) {
  const theme = useTheme();
  const provider = useAgentProviders().data?.providers.find((p) => p.id === agent);
  const face = gatewayAgent ? provider?.models.find((m) => m.slug === gatewayAgent) : undefined;
  const Mark = agentMark(kind ?? provider?.kind) ?? OtterMark;
  return (
    <Avatar
      size={size}
      source={face?.avatar ?? (face?.emoji ? null : provider?.avatar)}
      emoji={face?.emoji}
      mark={(at) => <Mark size={at} color={theme.colors.foreground} />}
    />
  );
}
