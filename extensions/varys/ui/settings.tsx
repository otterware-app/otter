import { osNames, searchableSetting, type AgentSettingsProps } from "@otter/web/extension-kit";
import { Button } from "@otter/ui/components/button";

import { useVarysConnection } from "../shared/connect";
import { VarysDeliveries } from "./deliveries";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { Input } from "@otter/ui/components/input";

export function VarysSettings({ provider }: AgentSettingsProps) {
  const {
    settings: { address: savedAddress, relay },
    connected,
    link,
    setLink,
    useCode,
    setUseCode,
    address,
    setAddress,
    code,
    setCode,
    saving,
    connect,
    disconnect,
  } = useVarysConnection(provider);
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;

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
                <Input
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
                <Input
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
              <Input
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
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : savedAddress ? "Pair again" : "Connect"}
            </Button>
          }
        />
        {savedAddress ? (
          <SettingsRow
            title="Disconnect"
            description={`Ends this ${device}'s access in varys, and forgets varys here.`}
            control={
              <Button size="sm" disabled={saving} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            }
          />
        ) : null}
      </SettingsSection>
      {connected ? <VarysDeliveries agent={provider.id} relay={relay} /> : null}
    </>
  );
}
