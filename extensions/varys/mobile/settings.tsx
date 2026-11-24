import type { AgentSettingsProps } from "@otter/mobile/extension-kit";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import { SettingsButton, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { useEffect, useRef } from "react";

import { useVarysConnection, useVarysRelay, type RelayState } from "../shared/connect";

const host = (address: string) => address.replace(/^[a-z]+:\/\//i, "").replace(/[:/].*$/, "");

/** Pairing this iPhone with varys (AgentSettings.swift's `varys`), and whether it can tell you what's new. */
export function VarysSettings({ provider }: AgentSettingsProps) {
  const connection = useVarysConnection(provider);
  const { settings, link, setLink, useCode, setUseCode, saving, connect, disconnect } = connection;
  /** Connect once the switch back to the pairing link is in the form, which `connect` reads. */
  const connectNext = useRef(false);
  const paired = Boolean(settings.address);

  useEffect(() => {
    if (!connectNext.current) return;
    connectNext.current = false;
    void connect();
  });

  if (paired && connection.connected) {
    return (
      <>
        <SettingsSection
          footer={`This iPhone has access of its own, listed in ${provider.name}. Disconnecting revokes it there and forgets it here.`}
        >
          <SettingsRow title="Address" icon="network" value={host(settings.address)} />
          <SettingsButton
            title="Disconnect"
            destructive
            disabled={saving}
            onPress={() => void disconnect()}
          />
        </SettingsSection>
        <VarysDeliveries agent={provider.id} relay={settings.relay} />
      </>
    );
  }

  return (
    <>
      <SettingsSection footer="Your varys agent, usually served on your tailnet with Tailscale Serve, so this iPhone needs Tailscale too. In varys, open Settings → Sharing & access → Connect an app. Choose Works as you and the Chat client preset, then paste the pairing link here. It works once.">
        <SettingsField placeholder="Pairing link" value={link} onChangeText={setLink} secret />
        <SettingsButton
          title={saving && !useCode ? "Connecting…" : paired ? "Pair again" : "Connect"}
          disabled={!link.trim() || saving}
          onPress={() => {
            if (!useCode) return void connect();
            connectNext.current = true;
            setUseCode(false);
          }}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsButton
          title={useCode ? "Use a pairing link" : "Type the address and code instead"}
          onPress={() => setUseCode(!useCode)}
        />
        {useCode ? (
          <SettingsField
            placeholder="https://computer.tailnet.ts.net"
            value={connection.address}
            onChangeText={connection.setAddress}
            url
          />
        ) : null}
        {useCode ? (
          <SettingsField
            placeholder="Code"
            value={connection.code}
            onChangeText={connection.setCode}
            secret
          />
        ) : null}
        {useCode ? (
          <SettingsButton
            title={saving ? "Connecting…" : "Connect with the code"}
            disabled={!connection.address.trim() || !connection.code.trim() || saving}
            onPress={() => void connect()}
          />
        ) : null}
        {paired ? (
          <SettingsButton
            title="Disconnect"
            destructive
            disabled={saving}
            onPress={() => void disconnect()}
          />
        ) : null}
      </SettingsSection>
    </>
  );
}

/** Whether varys tells your devices there's something new while Otter is closed. */
function VarysDeliveries({ agent, relay }: { agent: string; relay: RelayState }) {
  const { busy, turnOn } = useVarysRelay(agent);
  return (
    <SettingsSection
      title="Messages from varys"
      footer="While Otter is open, what varys does shows up at once. Through Otter's relay, varys also tells your devices when there's something new while it's closed: a routine's report, an approval, a question, a finished run. It stays in varys: the relay only hears which thread to read."
    >
      {relay === "signedOut" ? (
        <SettingsRow title="Sign in to your Otter account" />
      ) : relay === "on" ? (
        <SettingsRow title="On" icon="bell.badge" />
      ) : (
        <SettingsRow title="Off" icon="bell.slash" />
      )}
      {relay === "off" ? (
        <SettingsButton
          title={busy ? "Turning on…" : "Turn on"}
          disabled={busy}
          onPress={() => void turnOn()}
        />
      ) : null}
    </SettingsSection>
  );
}
