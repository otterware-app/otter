import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { formatAgo, lastChecked } from "@otter/client/agents/agent-settings";
import { SettingsPage } from "@otter/ui-native/components/settings";
import { Stack } from "expo-router";
import { useState } from "react";

import { AgentsSection } from "./agents-section.tsx";

/** Your agents: each one and its state, a gateway's agents, and Add agent. */
export function AgentsScreen() {
  const providers = useAgentProviders().data?.providers ?? [];
  const checked = lastChecked(providers);
  const [now] = useState(Date.now);
  return (
    <>
      <Stack.Screen options={{ title: "Agents" }} />
      <SettingsPage>
        <AgentsSection footer={checked ? `Checked ${formatAgo(now - checked)}` : undefined} />
      </SettingsPage>
    </>
  );
}
