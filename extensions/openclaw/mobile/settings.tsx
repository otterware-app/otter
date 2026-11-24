import { channelLastSent, useAgentChannels } from "@otter/client/agents/agent-channels";
import { enabledModels } from "@otter/client/agents/agent-providers";
import { agentApi } from "@otter/client/agents/api";
import type { AgentSettingsControls, AgentSettingsProps } from "@otter/mobile/extension-kit";
import { Button } from "@otter/ui-native/components/button";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import {
  SettingsButton,
  SettingsCell,
  SettingsRow,
  SettingsSection,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import {
  deliveryCommands,
  gatewayHost,
  setupCodeUrl,
  useOpenClawConnection,
} from "../shared/connect";

/**
 * How this iPhone reaches an OpenClaw gateway (AgentSettings.swift's `openClaw`): a setup code,
 * scanned or pasted, or the gateway's address and token; approving it there; full access; and
 * what the gateway sends to Otter.
 */
export function OpenClawSettings({ provider, update, controls }: AgentSettingsProps) {
  const connection = useOpenClawConnection(provider);
  const { settings, code, setCode, useToken, setUseToken, saving, connect } = connection;
  /** Connect once a new code (or the switch back to it) is in the form, which `connect` reads. */
  const connectNext = useRef(false);
  const footer = `${provider.name}'s gateway, usually over Tailscale. Scan the QR code in its Pair a device screen or from openclaw qr, or paste a setup code from openclaw qr --setup-code-only. Then approve this iPhone on the gateway. Chats live there, so they're the same everywhere; this iPhone's key and tokens stay on it.`;

  useEffect(() => {
    if (!connectNext.current) return;
    connectNext.current = false;
    void connect();
  });
  const connectWith = (next: string) => {
    if (next === code && !useToken) return void connect();
    connectNext.current = true;
    setUseToken(false);
    setCode(next);
  };

  if (connection.connected) {
    const models = enabledModels(provider).filter((m) => m.slug);
    return (
      <>
        <SettingsSection footer={footer}>
          <SettingsRow title="Gateway" icon="network" value={gatewayHost(settings.url)} />
          {models.length > 0 ? (
            <controls.PickerRow
              title="Agent"
              value={settings.model}
              options={[
                { value: "", label: "The gateway's default" },
                ...models.map((m) => ({ value: m.slug, label: m.name })),
              ]}
              onChange={(model) => update({ [provider.id]: { model } })}
            />
          ) : null}
        </SettingsSection>
        {settings.fullAccess.allowed === false ? (
          settings.fullAccess.request ? (
            <Approve
              title="Approve full access on the gateway:"
              request={settings.fullAccess.request}
              copy={controls.copy}
            />
          ) : (
            <SettingsSection
              footer={`This iPhone was paired with less than OpenClaw's own apps have, so ${provider.name} won't use your devices for what you ask here, and its questions may not reach you.`}
            >
              <SettingsButton
                title={connection.asking ? "Asking…" : "Allow full access"}
                disabled={connection.asking}
                onPress={() => void connection.allowFullAccess()}
              />
            </SettingsSection>
          )
        ) : null}
        <OpenClawDeliveries copy={controls.copy} />
      </>
    );
  }

  if (settings.pairingRequest) {
    return (
      <>
        <Approve
          title="Approve this iPhone on the gateway:"
          request={settings.pairingRequest}
          copy={controls.copy}
        />
        <SettingsSection>
          <SettingsButton
            title="Check again"
            onPress={() => void agentApi.refreshProviders(provider.id).catch(() => {})}
          />
        </SettingsSection>
      </>
    );
  }

  return (
    <>
      <SettingsSection title={settings.url ? "Connect on this iPhone" : undefined} footer={footer}>
        {settings.url ? (
          <SettingsRow title="Gateway" icon="network" value={gatewayHost(settings.url)} />
        ) : null}
        <SettingsRow
          title="Scan QR code"
          icon="qrcode.viewfinder"
          chevron={false}
          onPress={() =>
            void controls
              .scan({
                prompt: "Point your camera at the gateway's pairing QR code.",
                invalid:
                  "That isn't an OpenClaw setup code. Scan the QR code from Pair a device or openclaw qr.",
                accepts: (scannedCode) => setupCodeUrl(scannedCode) !== "",
              })
              .then((scannedCode) => {
                if (scannedCode) connectWith(scannedCode);
              })
          }
        />
        <SettingsField placeholder="Setup code" value={code} onChangeText={setCode} secret />
        <SettingsButton
          title={saving && !useToken ? "Connecting…" : "Connect"}
          disabled={!code.trim() || saving}
          onPress={() => connectWith(code)}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsButton
          title={useToken ? "Use a setup code" : "Use the gateway's token instead"}
          onPress={() => setUseToken(!useToken)}
        />
        {useToken ? (
          <SettingsField
            placeholder={settings.url || "wss://computer.tailnet.ts.net"}
            value={connection.url}
            onChangeText={connection.setUrl}
            url
          />
        ) : null}
        {useToken ? (
          <SettingsField
            placeholder="Gateway token"
            value={connection.token}
            onChangeText={connection.setToken}
            secret
          />
        ) : null}
        {useToken ? (
          <SettingsButton
            title={saving ? "Connecting…" : "Connect with the token"}
            disabled={
              !(connection.url.trim() || settings.url) || !connection.token.trim() || saving
            }
            onPress={() => void connect()}
          />
        ) : null}
      </SettingsSection>
    </>
  );
}

/** A request the gateway waits on you to approve there, and the command that does. */
function Approve({
  title,
  request,
  copy,
}: {
  title: string;
  request: string;
  copy: AgentSettingsControls["copy"];
}) {
  const theme = useTheme();
  const command = `openclaw devices approve ${request}`;
  return (
    <SettingsSection>
      <View style={{ padding: 16, gap: 6 }}>
        <Text size="base">{title}</Text>
        <Text
          selectable
          size="body"
          color="mutedForeground"
          style={{ fontFamily: theme.fonts.mono }}
        >
          {command}
        </Text>
      </View>
      <SettingsButton title="Copy the command" onPress={() => copy(command)} />
    </SettingsSection>
  );
}

/** Lets the gateway send what its agents deliver to Otter (extensions/openclaw/gateway). */
function OpenClawDeliveries({ copy }: { copy: AgentSettingsControls["copy"] }) {
  const theme = useTheme();
  const { channels, made, busy, signedOut, make, remove } = useAgentChannels(
    "OpenClaw",
    (c) => c.label !== "Hermes",
  );
  return (
    <SettingsSection
      title="Messages from your agents"
      footer="What OpenClaw sends to Otter (a scheduled job's result, an approval it waits on) shows up here as a chat with that agent, and notifies you. It stays on your gateway: Otter's relay only tells your devices there's something new."
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
              <Text size="base">Run these on the gateway's computer</Text>
              <Text size="sm" color="mutedForeground">
                The token is shown only now. Then send a job here with --announce --channel otter
                --to chat:new (a new chat each time), or --to chat:&lt;session key&gt; for one chat.
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
              title={busy ? "Setting up…" : channels?.length ? "Set up another gateway" : "Set up"}
              disabled={busy}
              onPress={() => void make()}
            />
          ),
        ]
      )}
    </SettingsSection>
  );
}
