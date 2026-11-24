import { channelLastSent, useAgentChannels } from "@otter/client/agents/agent-channels";
import { startingModel } from "@otter/client/agents/agent-providers";
import type { AgentSettingsControls, AgentSettingsProps } from "@otter/mobile/extension-kit";
import { Button } from "@otter/ui-native/components/button";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import {
  SettingsButton,
  SettingsCell,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useState } from "react";
import { View } from "react-native";

import {
  deliveryCommands,
  hermesConnected,
  hermesSettings,
  useConnectHermes,
} from "../shared/connect";

const host = (address: string) => address.replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "");

/** A Hermes agent's server, its model, and the messages it sends to Otter (AgentSettings.swift's `hermes`). */
export function HermesSettings({ provider, update, controls }: AgentSettingsProps) {
  const settings = hermesSettings(provider);
  const { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect } = useConnectHermes(provider);
  const [changing, setChanging] = useState(false);
  const footer = `${provider.name}'s server, reached from every device. Chats live on it, so they're the same here, on the Mac and on the web. The key follows your Otter account, sealed.`;

  if (hermesConnected(provider) && !changing) {
    const set = (key: string, value: string) => update({ [provider.id]: { [key]: value } });
    const models = provider.models.filter((m) => m.slug);
    const model = provider.models.find((m) => m.slug === startingModel(provider));
    const reasoning = model?.options?.find((o) => o.id === "reasoningEffort");
    const fast = model?.options?.find((o) => o.id === "serviceTier");
    return (
      <>
        <SettingsSection footer={footer}>
          <SettingsRow title="Server" icon="server.rack" value={host(settings.baseUrl)} />
          {models.length > 0 ? (
            <controls.PickerRow
              title="Model"
              value={settings.model}
              options={[
                { value: "", label: "Default" },
                ...models.map((m) => ({
                  value: m.slug,
                  label: m.subProvider ? `${m.name} · ${m.subProvider}` : m.name,
                })),
              ]}
              onChange={(value) => set("model", value)}
            />
          ) : null}
          {reasoning ? (
            <controls.PickerRow
              title="Reasoning"
              value={settings.reasoningEffort ?? ""}
              options={[
                { value: "", label: "Default" },
                ...reasoning.choices.map((c) => ({ value: c.id, label: c.label })),
              ]}
              onChange={(value) => set("reasoningEffort", value)}
            />
          ) : null}
          {fast ? (
            <SettingsSwitchRow
              title="Fast"
              value={settings.serviceTier === "priority"}
              onValueChange={(on) => set("serviceTier", on ? "priority" : "default")}
            />
          ) : null}
          <SettingsButton
            title="Change server or key"
            onPress={() => {
              setBaseUrl(settings.baseUrl);
              setChanging(true);
            }}
          />
        </SettingsSection>
        {provider.status === "ready" ? (
          <HermesDeliveries name={provider.name} copy={controls.copy} />
        ) : null}
      </>
    );
  }

  return (
    <SettingsSection footer={footer}>
      <SettingsField
        placeholder="https://hermes.example:8642"
        value={baseUrl}
        onChangeText={setBaseUrl}
        url
      />
      <SettingsField placeholder="API key" value={apiKey} onChangeText={setApiKey} secret />
      <SettingsButton
        title={saving ? "Connecting…" : "Connect"}
        disabled={!baseUrl.trim() || !apiKey.trim() || saving}
        onPress={() => void connect().then((ok) => ok && setChanging(false))}
      />
    </SettingsSection>
  );
}

/** Lets this Hermes send to Otter, as one of its platforms, with a channel named for it. */
function HermesDeliveries({ name, copy }: { name: string; copy: AgentSettingsControls["copy"] }) {
  const theme = useTheme();
  const { channels, made, busy, signedOut, make, remove } = useAgentChannels(
    name,
    (c) => c.label === name,
  );
  return (
    <SettingsSection
      title={`Messages from ${name}`}
      footer="With Otter's plugin, Otter is one of Hermes's platforms: what it sends here (a scheduled task's result, a message from its send_message tool) shows up at once as a chat, and notifies you. It stays on Hermes: Otter's relay only tells your devices there's something new."
    >
      {signedOut ? (
        <SettingsRow title="Sign in to your Otter account" />
      ) : (
        [
          ...(channels ?? []).map((c) => (
            <SettingsCell key={c.id}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text size="base" numberOfLines={1}>
                  {c.label}
                </Text>
                <Text size="sm" color="mutedForeground" numberOfLines={1}>
                  {channelLastSent(c)}
                </Text>
              </View>
              <Button title="Remove" size="sm" onPress={() => void remove(c.id)} />
            </SettingsCell>
          )),
          made ? (
            <View key="made" style={{ padding: 16, gap: 6 }}>
              <Text size="base">Run these where Hermes runs</Text>
              <Text size="sm" color="mutedForeground">
                The token is shown only now. Then a scheduled task can send its results to Otter
                (deliver: otter), and Hermes can message you here.
              </Text>
              {deliveryCommands(made).map((command) => (
                <Text
                  key={command}
                  selectable
                  size="body"
                  color="mutedForeground"
                  style={{ fontFamily: theme.fonts.mono }}
                >
                  {command}
                </Text>
              ))}
            </View>
          ) : null,
          made ? (
            <SettingsButton
              key="copy"
              title="Copy the commands"
              onPress={() => copy(deliveryCommands(made).join("\n"))}
            />
          ) : (
            <SettingsButton
              key="make"
              title={busy ? "Setting up…" : channels?.length ? "Set up again" : "Set up"}
              disabled={busy}
              onPress={() => void make()}
            />
          ),
        ]
      )}
    </SettingsSection>
  );
}
