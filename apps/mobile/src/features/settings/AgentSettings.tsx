import { Picker, Text } from "@expo/ui/swift-ui";
import { tag } from "@expo/ui/swift-ui/modifiers";

import { agentContribution } from "../../extensions/registry";
import { updateAgentSettings, useAgents } from "../../state/chats";
import type { Palette } from "../theme";
import { Group, SettingsForm } from "./SettingsScreen";

/**
 * apps/ios's AgentSettings: which agent new chats use, and that agent's own
 * section, from its extension's `./mobile` half.
 */
export function AgentSettings({ colors, signedIn }: { colors: Palette; signedIn: boolean }) {
  const { providers, selected } = useAgents();
  const provider = providers.find((p) => p.kind === selected) ?? providers[0];
  const Settings = provider ? agentContribution(provider.kind)?.Settings : undefined;

  return (
    <SettingsForm colors={colors} title="Agents">
      {providers.length > 1 ? (
        <Group colors={colors}>
          <Picker
            label="Agent"
            selection={provider?.kind ?? ""}
            onSelectionChange={(kind: string) => void updateAgentSettings({ selected: kind })}
          >
            {providers.map((p) => (
              <Text key={p.kind} modifiers={[tag(p.kind)]}>
                {agentName(p)}
              </Text>
            ))}
          </Picker>
        </Group>
      ) : null}
      {provider && Settings ? (
        <Settings provider={provider} colors={colors} signedIn={signedIn} />
      ) : null}
    </SettingsForm>
  );
}

/** apps/ios calls the Otter Mail agent by the service it runs on. */
export const agentName = (p: { kind: string; displayName: string }) =>
  p.kind === "openrouter" ? "OpenRouter" : p.displayName;
