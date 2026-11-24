import {
  ModelsSection,
  Command,
  osNames,
  searchableSetting,
  type AgentSettingsProps,
} from "@otter/web/extension-kit";
import { Button } from "@otter/ui/components/button";
import { Switch } from "@otter/ui/components/switch";
import { disabledAgents } from "@otter/client/agents/agent-providers";

import { gatewayAgentPatch, useOpenClawConnection } from "../shared/connect";
import { OpenClawDeliveries } from "./deliveries";
import { OpenClawAgents } from "./models";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { Input } from "@otter/ui/components/input";

const SITE_ORIGIN = window.desktopBridge.platform === "web" ? location.origin : null;

export function OpenClawSettings({ provider, update }: AgentSettingsProps) {
  const {
    settings: {
      url: savedUrl,
      pairingRequest: openclawPairingRequest,
      fullAccess: openclawFullAccess,
      owner: openclawOwner,
    },
    connected,
    host,
    code,
    setCode,
    useToken,
    setUseToken,
    url,
    setUrl,
    token,
    setToken,
    saving,
    connect,
    asking,
    allowFullAccess,
    allowOwner,
  } = useOpenClawConnection(provider);
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;

  return (
    <>
      {connected ? null : (
        <SettingsSection
          title="Set up"
          description={`Run these on the computer where OpenClaw runs. This ${device} reaches it over Tailscale, so it needs Tailscale too, on the same tailnet.`}
        >
          <SettingsRow
            title="1. Serve the gateway on your tailnet"
            description="Skip this if it already runs with Tailscale Serve. Its address becomes wss://<computer>.<tailnet>.ts.net."
          >
            <Command value="openclaw config set gateway.tailscale.mode serve" />
            <Command value="openclaw gateway restart" />
          </SettingsRow>
          {SITE_ORIGIN ? (
            <SettingsRow
              title="2. Allow Otter on the web"
              description="Browsers may only connect from sites the gateway allows. This keeps the gateway's own Control UI allowed; add any other sites you allowed before."
            >
              <Command
                value={`openclaw config set gateway.controlUi.allowedOrigins '${JSON.stringify([
                  `https://${host || "<computer>.<tailnet>.ts.net"}`,
                  SITE_ORIGIN,
                ])}'`}
              />
            </SettingsRow>
          ) : null}
          <SettingsRow
            title={`${SITE_ORIGIN ? 3 : 2}. Make a setup code`}
            description="Paste it below. It holds the gateway's address and works once, for 10 minutes."
          >
            <Command value="openclaw qr --setup-code-only --limited" />
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection {...searchableSetting("openclaw-connection")}>
        {savedUrl ? (
          <SettingsRow
            title="Gateway"
            description={<span className="font-mono text-xs">{savedUrl}</span>}
          />
        ) : null}
        {useToken ? (
          <>
            <SettingsRow
              title="Gateway address"
              description="wss://<computer>.<tailnet>.ts.net"
              control={
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={savedUrl ? "Change address" : "computer.tailnet.ts.net"}
                  aria-label="OpenClaw gateway address"
                  className="@min-[32rem]/settings-row:w-56"
                />
              }
            />
            <SettingsRow
              title="Gateway token"
              description="gateway.auth.token, which this prints on the gateway's computer. It stays on this device."
              control={
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Token"
                  aria-label="OpenClaw gateway token"
                  className="@min-[32rem]/settings-row:w-56"
                />
              }
            >
              {/* `openclaw config get` redacts secrets, so read the config file itself. */}
              <Command value={`node -p "require('$(openclaw config file)').gateway.auth.token"`} />
            </SettingsRow>
          </>
        ) : (
          <SettingsRow
            title="Setup code"
            description="From openclaw qr --setup-code-only."
            control={
              <Input
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste setup code"
                aria-label="OpenClaw setup code"
                className="@min-[32rem]/settings-row:w-56"
              />
            }
          />
        )}
        <SettingsRow
          title={savedUrl ? "Reconnect" : "Connect"}
          description={
            <>
              Connects this {device} to the gateway. The first time, you approve it there.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setUseToken(!useToken)}
              >
                {useToken ? "Use a setup code instead" : "Use the gateway token instead"}
              </button>
            </>
          }
          control={
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : savedUrl ? "Reconnect" : "Connect"}
            </Button>
          }
        />
        {openclawPairingRequest ? (
          <SettingsRow
            title={`Approve this ${device}`}
            description={`The gateway is waiting for you to approve this ${device}. Run this on its computer; Otter connects as soon as you do.`}
          >
            <Command value={`openclaw devices approve ${openclawPairingRequest}`} />
          </SettingsRow>
        ) : null}
        {connected && openclawFullAccess.allowed === false ? (
          <SettingsRow
            title="Full access"
            description={
              openclawFullAccess.request
                ? "The gateway is waiting for you to approve it. Run this on its computer; Otter reconnects with full access once you do."
                : `This ${device} was paired with less than OpenClaw's own apps have, so the agent won't use your devices (its nodes tool) for what you ask here, its questions may not reach you, and Otter can't change which models it uses. Allowing it asks the gateway for full access, and you approve it there.`
            }
            control={
              openclawFullAccess.request ? null : (
                <Button size="sm" disabled={asking} onClick={() => void allowFullAccess()}>
                  {asking ? "Asking…" : "Allow"}
                </Button>
              )
            }
          >
            {openclawFullAccess.request ? (
              <Command value={`openclaw devices approve ${openclawFullAccess.request}`} />
            ) : null}
          </SettingsRow>
        ) : null}
        {connected && openclawOwner === false ? (
          <SettingsRow
            title="Manage every scheduled task"
            description="A chat can only see and change the scheduled tasks it made, and the agent doesn't know which Otter chats it can post to. Allowing this lists Otter as one of the gateway's owners (commands.ownerAllowFrom), as you would your own Telegram account, so any chat can manage them all, and lets Otter's plugin tell the agent where it can deliver: this chat, or a new chat each time."
            control={
              <Button size="sm" disabled={asking} onClick={() => void allowOwner()}>
                {asking ? "Allowing…" : "Allow"}
              </Button>
            }
          />
        ) : null}
      </SettingsSection>
      {connected && provider.models.length > 0 ? (
        <SettingsSection
          title="Agents"
          description="An agent turned off isn't offered for new chats, and its chats wait until it's back on. The same on every device."
        >
          {provider.models.map((m) => (
            <SettingsRow
              key={m.slug}
              title={m.name}
              control={
                <Switch
                  aria-label={`Use ${m.name}`}
                  checked={!disabledAgents(provider).includes(m.slug)}
                  onCheckedChange={(on) => update(gatewayAgentPatch(provider, m.slug, on))}
                />
              }
            />
          ))}
        </SettingsSection>
      ) : null}
      {connected ? <OpenClawDeliveries /> : null}
      {connected ? (
        <OpenClawAgents key={openclawFullAccess.allowed ? "full" : "limited"} agent={provider.id} />
      ) : null}
      {connected ? (
        <ModelsSection
          provider={provider}
          selectedModel={provider.settings.model}
          onPick={(model) => update({ [provider.id]: { model } })}
        />
      ) : null}
    </>
  );
}
