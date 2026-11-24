import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { useLocalSearchParams } from "expo-router";

import { Placeholder } from "../frame/placeholder.tsx";

/** An agent's page (AgentSettings.swift): its name, picture, switch, connection, and Remove. */
export function AgentPage() {
  const { id } = useLocalSearchParams<"/settings/agents/[id]">();
  const name = useAgentProviders().data?.providers.find((p) => p.id === id)?.name ?? "Agent";
  return (
    <Placeholder
      title={name}
      line="The agent's name, picture, connection and Remove go here."
      icon="person.crop.circle"
    />
  );
}
