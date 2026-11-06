import {
  Button,
  HStack,
  Host,
  Image,
  Menu,
  Picker,
  Section,
  Text,
  Toggle,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";

import { RUNTIME_MODES } from "../../extensions/kit";
import { agentContribution } from "../../extensions/registry";
import { isProviderUsable, updateAgentSettings, type AgentProvider } from "../../state/chats";
import { agentName } from "../settings/AgentSettings";
import type { Palette } from "../theme";
import { fastChoice, shortModelName } from "./chat-logic";

/**
 * The chat's title, the Swift app's model menu: the agent (while the chat is
 * new), its models by provider, Reasoning, Fast, and how tools are approved.
 */
export function AgentMenu({
  providers,
  provider,
  locked,
  colors,
  onPickAgent,
}: {
  providers: AgentProvider[];
  provider: AgentProvider | undefined;
  /** The chat has begun: its agent, and an OpenClaw chat's agent, stay. */
  locked: boolean;
  colors: Palette;
  onPickAgent: (kind: string) => void;
}) {
  if (!provider) return null;
  const kind = provider.kind;
  const contribution = agentContribution(kind);
  const agents = providers.filter(isProviderUsable);
  const model = provider.models.find((m) => m.slug === provider.model);
  const models = locked && kind === "openclaw" ? [] : provider.models;
  const groups = new Map<string, typeof models>();
  for (const m of models) {
    const group = m.subProvider ?? agentName(provider);
    groups.set(group, [...(groups.get(group) ?? []), m]);
  }
  const tuned = !contribution?.ownModelSettings;
  const reasoning = tuned ? model?.options?.find((o) => o.id === "reasoningEffort") : undefined;
  const fast = tuned ? fastChoice(model?.options) : undefined;
  const runtimeMode = contribution?.serverApprovals ? undefined : provider.settings.runtimeMode;
  const set = (patch: Record<string, unknown>) => void updateAgentSettings({ [kind]: patch });
  const empty =
    (locked || agents.length < 2) && groups.size === 0 && !reasoning && !fast && !runtimeMode;

  const label = (
    <HStack spacing={4} modifiers={[frame({ maxWidth: 240 })]}>
      <Text modifiers={[font({ textStyle: "headline" }), foregroundStyle(colors.text)]}>
        {agentName(provider)}
      </Text>
      {model ? (
        <Text
          modifiers={[
            font({ textStyle: "headline" }),
            foregroundStyle(colors.secondary),
            lineLimit(1),
          ]}
        >
          {shortModelName(model.name)}
        </Text>
      ) : null}
      {empty ? null : <Image systemName="chevron.down" size={11} color={colors.secondary} />}
    </HStack>
  );

  return (
    <Host matchContents colorScheme={colors.dark ? "dark" : "light"}>
      {empty ? (
        label
      ) : (
        <Menu label={label} modifiers={[accessibilityIdentifier("chat-agent-menu")]}>
          {!locked && agents.length > 1 ? (
            <Section title="Agent">
              {agents.map((p) => (
                <Button
                  key={p.kind}
                  label={agentName(p)}
                  systemImage={p.kind === kind ? "checkmark" : undefined}
                  onPress={() => onPickAgent(p.kind)}
                />
              ))}
            </Section>
          ) : null}
          {[...groups.keys()].sort().map((group) => (
            <Section key={group} title={group}>
              {groups.get(group)!.map((m) => (
                <Button
                  key={m.slug}
                  label={m.name}
                  systemImage={m.slug === model?.slug ? "checkmark" : undefined}
                  onPress={() =>
                    void updateAgentSettings({ selected: kind, [kind]: { model: m.slug } })
                  }
                />
              ))}
            </Section>
          ))}
          {reasoning ? (
            <Picker
              label="Reasoning"
              systemImage="brain"
              selection={provider.settings.reasoningEffort ?? ""}
              onSelectionChange={(reasoningEffort: string) => set({ reasoningEffort })}
              modifiers={[pickerStyle("menu")]}
            >
              {reasoning.choices.map((c) => (
                <Text key={c.id} modifiers={[tag(c.id)]}>
                  {c.label}
                </Text>
              ))}
            </Picker>
          ) : null}
          {fast ? (
            <Toggle
              label="Fast"
              systemImage="hare"
              isOn={provider.settings.serviceTier === fast}
              onIsOnChange={(on) => set({ serviceTier: on ? fast : "default" })}
            />
          ) : null}
          {runtimeMode ? (
            <Picker
              label="Tool approval"
              systemImage="checkmark.shield"
              selection={runtimeMode}
              onSelectionChange={(mode: string) => set({ runtimeMode: mode })}
              modifiers={[pickerStyle("menu")]}
            >
              {RUNTIME_MODES.map(([id, title]) => (
                <Text key={id} modifiers={[tag(id)]}>
                  {title}
                </Text>
              ))}
            </Picker>
          ) : null}
        </Menu>
      )}
    </Host>
  );
}
