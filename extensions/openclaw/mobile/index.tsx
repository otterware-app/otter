import {
  Command,
  SettingsGroup,
  SwiftUI,
  SwiftUIModifiers,
  agentStatus,
  errorText,
  invoke,
  invokeProviders,
  updateAgentSettings,
  type AgentSettingsProps,
  type MobileExtension,
} from "@otter-mail/mobile/extension-kit";
import { useEffect, useState } from "react";

import { manifest } from "../manifest";
import { OpenClawDeliveries } from "./deliveries";

const {
  Button,
  DisclosureGroup,
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
  textInputAutocapitalization,
} = SwiftUIModifiers;

const host = (url: string) => url.replace(/^[a-z]+:\/\//i, "").replace(/[/:].*$/, "") || url;

type View = {
  url: string;
  pairingRequest: string | null;
  questions: { allowed: boolean | null; request: string | null };
};

/** apps/ios's OpenClaw section: a setup code (or the gateway's token), approved on the gateway. */
function OpenClawSettings({ provider, colors, signedIn }: AgentSettingsProps) {
  const settings = provider.settings as typeof provider.settings & View;
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const codeField = useNativeState("");
  const tokenField = useNativeState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = agentStatus(provider);
  const ready = provider.status === "ready";
  const pairing = settings.pairingRequest;

  // Connects as soon as the gateway approves this iPhone.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => void invoke("agent:refreshProviders").catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [pairing]);

  const connect = async (params: { code: string } | { url: string; token: string }) => {
    setConnecting(true);
    setError(null);
    try {
      await invokeProviders("agent:connectOpenClaw", params);
      setCode("");
      setToken("");
      codeField.set("");
      tokenField.set("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  };

  const allowQuestions = async () => {
    setError(null);
    try {
      await invokeProviders("agent:allowOpenClawQuestions");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <SettingsGroup
        colors={colors}
        footer={
          <Text>
            Your OpenClaw gateway, usually over Tailscale. Make a setup code on it with openclaw qr
            --setup-code-only and paste it here, then approve this iPhone there. Chats live on the
            gateway, so they're the same everywhere; this iPhone's key and tokens stay on it.
          </Text>
        }
      >
        <Toggle
          isOn={provider.enabled}
          onIsOnChange={(enabled) => void updateAgentSettings({ openclaw: { enabled } })}
        >
          <VStack alignment="leading" spacing={2}>
            <Text>OpenClaw</Text>
            <Text
              modifiers={[
                font({ textStyle: "subheadline" }),
                foregroundStyle(status.color(colors)),
              ]}
            >
              {status.text}
            </Text>
          </VStack>
        </Toggle>
        {provider.enabled ? (
          <>
            {settings.url ? (
              <LabeledContent label="Gateway">
                <Text modifiers={[foregroundStyle(colors.secondary)]}>{host(settings.url)}</Text>
              </LabeledContent>
            ) : null}
            {ready ? (
              <>
                {provider.models.length > 0 ? (
                  <Picker
                    label="Agent"
                    selection={settings.model}
                    onSelectionChange={(model: string) =>
                      void updateAgentSettings({ openclaw: { model } })
                    }
                  >
                    <Text modifiers={[tag("")]}>The gateway's default</Text>
                    {provider.models.map((m) => (
                      <Text key={m.slug} modifiers={[tag(m.slug)]}>
                        {m.name}
                      </Text>
                    ))}
                  </Picker>
                ) : null}
                {settings.questions?.allowed === false ? (
                  settings.questions.request ? (
                    <Command
                      colors={colors}
                      title="Approve answering its questions on the gateway:"
                      value={`openclaw devices approve ${settings.questions.request}`}
                    />
                  ) : (
                    <VStack alignment="leading" spacing={4}>
                      <Button
                        label="Allow answering its questions"
                        onPress={() => void allowQuestions()}
                      />
                      <Text
                        modifiers={[
                          font({ textStyle: "footnote" }),
                          foregroundStyle(colors.secondary),
                        ]}
                      >
                        OpenClaw sometimes stops to ask you something. This iPhone was paired before
                        it could answer.
                      </Text>
                    </VStack>
                  )
                ) : null}
              </>
            ) : pairing ? (
              <>
                <Command
                  colors={colors}
                  title="Approve this iPhone on the gateway:"
                  value={`openclaw devices approve ${pairing}`}
                />
                <Button
                  label="Check again"
                  onPress={() => void invoke("agent:refreshProviders").catch(() => {})}
                />
              </>
            ) : (
              <>
                <SecureField
                  placeholder="Setup code"
                  text={codeField}
                  onTextChange={setCode}
                  modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
                />
                <Button
                  label={connecting ? "Connecting…" : "Connect"}
                  onPress={() => void connect({ code })}
                  modifiers={[disabled(!code.trim() || connecting)]}
                />
                <DisclosureGroup label="Use the gateway's token instead">
                  <TextField
                    placeholder="wss://computer.tailnet.ts.net"
                    onTextChange={setUrl}
                    modifiers={[
                      keyboardType("url"),
                      textInputAutocapitalization("never"),
                      autocorrectionDisabled(),
                    ]}
                  />
                  <SecureField
                    placeholder="Gateway token"
                    text={tokenField}
                    onTextChange={setToken}
                    modifiers={[textInputAutocapitalization("never"), autocorrectionDisabled()]}
                  />
                  <Button
                    label="Connect with the token"
                    onPress={() => void connect({ url, token })}
                    modifiers={[disabled(!url.trim() || !token.trim() || connecting)]}
                  />
                </DisclosureGroup>
                {provider.status === "error" && provider.message ? (
                  <Text modifiers={[foregroundStyle(colors.error)]}>{provider.message}</Text>
                ) : null}
              </>
            )}
            {error ? <Text modifiers={[foregroundStyle(colors.error)]}>{error}</Text> : null}
          </>
        ) : null}
      </SettingsGroup>
      {provider.enabled ? <OpenClawDeliveries colors={colors} signedIn={signedIn} /> : null}
    </>
  );
}

export default {
  manifest,
  agent: { Settings: OpenClawSettings, serverApprovals: true, ownModelSettings: true },
} satisfies MobileExtension;
