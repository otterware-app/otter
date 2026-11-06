import {
  SettingsGroup,
  SwiftUI,
  SwiftUIModifiers,
  agentStatus,
  errorText,
  invokeProviders,
  updateAgentSettings,
  type AgentSettingsProps,
  type MobileExtension,
} from "@otter-mail/mobile/extension-kit";
import { useState } from "react";

import { manifest } from "../manifest";

const {
  Button,
  LabeledContent,
  Picker,
  SecureField,
  Text,
  TextField,
  Toggle,
  VStack,
  useNativeState,
} = SwiftUI;
const {
  autocorrectionDisabled,
  disabled,
  font,
  foregroundStyle,
  keyboardType,
  tag,
  textContentType,
  textInputAutocapitalization,
} = SwiftUIModifiers;

const host = (url: string) => url.replace(/^[a-z]+:\/\//i, "").replace(/[/:].*$/, "") || url;

/** the Swift app's Hermes section: the server's address and key, then its model, Reasoning and Fast. */
function HermesSettings({ provider, colors }: AgentSettingsProps) {
  const settings = provider.settings as typeof provider.settings & {
    baseUrl: string;
    hasKey: boolean;
  };
  const [url, setUrl] = useState(settings.baseUrl);
  const [key, setKey] = useState("");
  const urlField = useNativeState(settings.baseUrl);
  const keyField = useNativeState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = agentStatus(provider);
  const connected = Boolean(settings.baseUrl && settings.hasKey);
  const model = provider.models.find((m) => m.slug === provider.model);
  const option = (id: "reasoningEffort" | "serviceTier") =>
    model?.options?.find((o) => o.id === id);
  const reasoning = option("reasoningEffort");
  const fast = option("serviceTier")?.choices.find((c) => c.label === "Fast");
  const set = (patch: Record<string, unknown>) => void updateAgentSettings({ hermes: patch });

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await invokeProviders("agent:connectHermes", { baseUrl: url, apiKey: key });
      setKey("");
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
          Your agent server, reached from every device. Chats live on it, so they're the same here,
          on the Mac and on the web. The key follows your Otter account, sealed.
        </Text>
      }
    >
      <Toggle isOn={provider.enabled} onIsOnChange={(enabled) => set({ enabled })}>
        <VStack alignment="leading" spacing={2}>
          <Text>Hermes</Text>
          <Text
            modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(status.color(colors))]}
          >
            {status.text}
          </Text>
        </VStack>
      </Toggle>
      {provider.enabled && connected ? (
        <>
          <LabeledContent label="Server">
            <Text modifiers={[foregroundStyle(colors.secondary)]}>{host(settings.baseUrl)}</Text>
          </LabeledContent>
          {provider.models.length > 0 ? (
            <Picker
              label="Model"
              selection={settings.model}
              onSelectionChange={(slug: string) => set({ model: slug })}
            >
              <Text modifiers={[tag("")]}>Hermes' default</Text>
              {provider.models
                .filter((m) => m.slug)
                .map((m) => (
                  <Text key={m.slug} modifiers={[tag(m.slug)]}>
                    {m.subProvider ? `${m.name} · ${m.subProvider}` : m.name}
                  </Text>
                ))}
            </Picker>
          ) : null}
          {reasoning ? (
            <Picker
              label="Reasoning"
              selection={settings.reasoningEffort ?? ""}
              onSelectionChange={(reasoningEffort: string) => set({ reasoningEffort })}
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
              isOn={settings.serviceTier === fast.id}
              onIsOnChange={(on) => set({ serviceTier: on ? fast.id : "default" })}
            />
          ) : null}
          <Button
            label="Disconnect"
            role="destructive"
            onPress={() =>
              void invokeProviders("agent:disconnectHermes").catch((e: unknown) =>
                setError(errorText(e)),
              )
            }
          />
        </>
      ) : provider.enabled ? (
        <>
          <TextField
            placeholder="https://hermes.example:8642"
            text={urlField}
            onTextChange={setUrl}
            modifiers={[
              keyboardType("url"),
              textContentType("URL"),
              textInputAutocapitalization("never"),
              autocorrectionDisabled(),
            ]}
          />
          <SecureField
            placeholder="API key"
            text={keyField}
            onTextChange={setKey}
            modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
          />
          <Button
            label={connecting ? "Connecting…" : "Connect"}
            onPress={() => void connect()}
            modifiers={[disabled(!url.trim() || !key.trim() || connecting)]}
          />
          {error ? <Text modifiers={[foregroundStyle(colors.error)]}>{error}</Text> : null}
          {provider.status === "error" && provider.message ? (
            <Text modifiers={[foregroundStyle(colors.error)]}>{provider.message}</Text>
          ) : null}
        </>
      ) : null}
    </SettingsGroup>
  );
}

export default {
  manifest,
  agent: { Settings: HermesSettings, serverApprovals: true },
} satisfies MobileExtension;
