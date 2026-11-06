import {
  RUNTIME_MODES,
  SettingsGroup,
  SwiftUI,
  SwiftUIModifiers,
  agentStatus,
  devAgentServer,
  errorText,
  invokeProviders,
  updateAgentSettings,
  type AgentSettingsProps,
  type MobileExtension,
} from "@otter-mail/mobile/extension-kit";
import { useState } from "react";

import { manifest } from "../manifest";

const { Button, LabeledContent, Link, Picker, SecureField, Text, Toggle, useNativeState } = SwiftUI;
const { autocorrectionDisabled, disabled, foregroundStyle, tag, textInputAutocapitalization } =
  SwiftUIModifiers;

/** apps/ios's OpenRouter section: the key stays on Otter Mail's server, so it needs the Otter account. */
function OpenRouterSettings({ provider, colors, signedIn }: AgentSettingsProps) {
  const [apiKey, setApiKey] = useState("");
  const keyField = useNativeState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = provider.status === "ready";
  const canConnect = signedIn || devAgentServer;
  const status = agentStatus(provider);

  const run = async (channel: string, params?: unknown) => {
    setConnecting(true);
    setError(null);
    try {
      await invokeProviders(channel, params);
      setApiKey("");
      keyField.set("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <SettingsGroup
      colors={colors}
      footer={
        <Text>
          {canConnect
            ? "The API key stays on Otter Mail's server. When you use this agent, your prompts and mail returned by its tools are sent to Otter Mail's server, OpenRouter and the selected model provider. Chat history stays until you delete the chat or your Otter account. Usage is billed to your OpenRouter account."
            : "Sign in to your Otter account to connect OpenRouter."}
        </Text>
      }
    >
      <Toggle
        label="OpenRouter"
        isOn={provider.enabled}
        onIsOnChange={(enabled) => void updateAgentSettings({ openrouter: { enabled } })}
      />
      {provider.enabled ? (
        <>
          <LabeledContent label="Status">
            <Text modifiers={[foregroundStyle(status.color(colors))]}>{status.text}</Text>
          </LabeledContent>
          <SecureField
            text={keyField}
            placeholder="OpenRouter API key"
            onTextChange={setApiKey}
            modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
          />
          <Button
            label={connecting ? "Connecting…" : connected ? "Update key" : "Connect"}
            onPress={() => void run("agent:connectOpenRouter", { apiKey })}
            modifiers={[disabled(!apiKey || connecting || !canConnect)]}
          />
          {connected ? (
            <>
              <Picker
                label="Model"
                selection={provider.settings.model}
                onSelectionChange={(model: string) =>
                  void updateAgentSettings({ openrouter: { model } })
                }
              >
                <Text modifiers={[tag("")]}>Server default</Text>
                {provider.models.map((m) => (
                  <Text key={m.slug} modifiers={[tag(m.slug)]}>
                    {m.name}
                  </Text>
                ))}
              </Picker>
              <Picker
                label="Tool approval"
                selection={provider.settings.runtimeMode ?? "approval-required"}
                onSelectionChange={(runtimeMode: string) =>
                  void updateAgentSettings({ openrouter: { runtimeMode } })
                }
              >
                {RUNTIME_MODES.map(([id, label]) => (
                  <Text key={id} modifiers={[tag(id)]}>
                    {label}
                  </Text>
                ))}
              </Picker>
              <Button
                label="Disconnect"
                role="destructive"
                onPress={() => void run("agent:disconnectOpenRouter")}
              />
            </>
          ) : null}
          {error ? <Text modifiers={[foregroundStyle(colors.error)]}>{error}</Text> : null}
          {provider.status === "error" && provider.message ? (
            <Text modifiers={[foregroundStyle(colors.error)]}>{provider.message}</Text>
          ) : null}
          <Link label="Get an API key" destination="https://openrouter.ai/settings/keys" />
          <Link label="Usage and credits" destination="https://openrouter.ai/activity" />
        </>
      ) : null}
    </SettingsGroup>
  );
}

export default {
  manifest,
  agent: { Settings: OpenRouterSettings },
} satisfies MobileExtension;
