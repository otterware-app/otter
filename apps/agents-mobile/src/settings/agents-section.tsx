import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { agentStatus, useUpdateAgents } from "@otter/client/agents/agent-settings";
import { SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { router } from "expo-router";
import { View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useChooseAgent } from "./add-agent.tsx";
import { agentKind } from "./agent-kinds.ts";
import { MenuButton } from "./menus.tsx";

const openAgent = (id: string) =>
  router.push({ pathname: "/settings/agents/[id]", params: { id } });

/** Your agents, each with its state, a gateway's agents with a switch each, and Add agent. */
export function AgentsSection({ title, footer }: { title?: string; footer?: string }) {
  const state = useAgentProviders().data;
  const update = useUpdateAgents();
  const choose = useChooseAgent(openAgent);
  const rows = (state?.providers ?? []).map((p) => {
    const Rows = p.models.length > 0 ? agentKind(p.kind)?.Rows : undefined;
    return (
      <View key={p.id}>
        <SettingsRow
          title={p.name}
          value={agentStatus(p).text}
          icon={<AgentAvatar agent={p.id} size={22} />}
          onPress={() => openAgent(p.id)}
        />
        {Rows ? <Rows provider={p} update={update} /> : null}
      </View>
    );
  });
  return (
    <SettingsSection title={title} footer={footer}>
      {rows}
      <MenuButton
        key="add"
        accessibilityLabel="Add agent"
        actions={(state?.kinds ?? []).map((k) => ({
          title: k.name,
          onPress: () => choose(k.kind),
        }))}
      >
        <View style={{ width: "100%" }}>
          <SettingsRow title="Add agent" icon="plus" chevron={false} />
        </View>
      </MenuButton>
    </SettingsSection>
  );
}
