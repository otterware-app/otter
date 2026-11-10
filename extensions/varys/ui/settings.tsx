import {
  Btn,
  SettingsRow,
  SettingsSection,
  TextInput,
  osNames,
  searchableSetting,
  toast,
  useSetProvidersState,
  type AgentSettingsProps,
  type ProviderSnapshot,
} from "@otter/web/extension-kit";
import { useState } from "react";

import { varysApi } from "./api";
import { VarysDeliveries, type RelayState } from "./deliveries";

export function VarysSettings({ provider }: AgentSettingsProps) {
  const setState = useSetProvidersState();
  const [link, setLink] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const { address: savedAddress, relay } = provider.settings as ProviderSnapshot["settings"] & {
    address: string;
    relay: RelayState;
  };
  const connected = provider.status === "ready";
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;

  const disconnect = async () => {
    setSaving(true);
    try {
      const { state, notice } = await varysApi.disconnectVarys();
      setState(state);
      if (notice) toast.warning(notice);
    } catch (error) {
      toast.error(
        `Could not disconnect: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    if (useCode ? !address.trim() || !code.trim() : !link.trim()) {
      toast.error(
        useCode ? "varys's address and the code are both required" : "Paste a pairing link",
      );
      return;
    }
    setSaving(true);
    console.log("[Settings:connectVarys]", useCode ? "code" : "link");
    try {
      setState(
        await varysApi.connectVarys(
          useCode ? { address: address.trim(), code: code.trim() } : { link: link.trim() },
        ),
      );
      setLink("");
      setAddress("");
      setCode("");
    } catch (error) {
      toast.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {connected ? null : (
        <SettingsSection
          title="Set up"
          description={`This ${device} reaches varys over Tailscale, so it needs Tailscale too, on the same tailnet.`}
        >
          <SettingsRow
            title="1. Serve varys on your tailnet"
            description="varys up does it with Tailscale Serve, so varys has an https address, such as https://<computer>.<tailnet>.ts.net."
          />
          <SettingsRow
            title="2. Make an app code"
            description="In varys, open Settings → Sharing & access → Connect an app. Choose Works as you and the Chat client preset, then copy the pairing link. It works once."
          />
        </SettingsSection>
      )}
      <SettingsSection {...searchableSetting("varys-connection")}>
        {savedAddress ? (
          <SettingsRow
            title="varys"
            description={<span className="font-mono text-xs">{savedAddress}</span>}
          />
        ) : null}
        {useCode ? (
          <>
            <SettingsRow
              title="Address"
              description="https://<computer>.<tailnet>.ts.net"
              control={
                <TextInput
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="https://computer.tailnet.ts.net"
                  aria-label="varys's address"
                  className="@min-[32rem]/settings-row:w-56"
                />
              }
            />
            <SettingsRow
              title="Code"
              description="The code from Connect an app, in varys."
              control={
                <TextInput
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABCD-EFGH-JKMN"
                  aria-label="varys app code"
                  className="@min-[32rem]/settings-row:w-56"
                />
              }
            />
          </>
        ) : (
          <SettingsRow
            title="Pairing link"
            description="From Connect an app, in varys."
            control={
              <TextInput
                type="password"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste pairing link"
                aria-label="varys pairing link"
                className="@min-[32rem]/settings-row:w-56"
              />
            }
          />
        )}
        <SettingsRow
          title={savedAddress ? "Pair again" : "Connect"}
          description={
            <>
              Pairs this {device} with varys, with access of its own that you can revoke there.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setUseCode(!useCode)}
              >
                {useCode ? "Use the pairing link instead" : "Type the address and code instead"}
              </button>
            </>
          }
          control={
            <Btn size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : savedAddress ? "Pair again" : "Connect"}
            </Btn>
          }
        />
        {savedAddress ? (
          <SettingsRow
            title="Disconnect"
            description={`Ends this ${device}'s access in varys, and forgets varys here.`}
            control={
              <Btn size="sm" disabled={saving} onClick={() => void disconnect()}>
                Disconnect
              </Btn>
            }
          />
        ) : null}
      </SettingsSection>
      {connected ? <VarysDeliveries relay={relay} /> : null}
    </>
  );
}
