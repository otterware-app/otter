import {
  Btn,
  ModelsSection,
  mailApi,
  Command,
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
import { useEffect, useState } from "react";

import { openClawApi } from "./api";
import { OpenClawDeliveries } from "./deliveries";

const SITE_ORIGIN = window.desktopBridge.platform === "web" ? location.origin : null;

const gatewayHost = (address: string) =>
  address
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "");

function setupCodeUrl(code: string): string {
  try {
    const json = JSON.parse(atob(code.trim().replace(/-/g, "+").replace(/_/g, "/"))) as {
      url?: unknown;
    };
    return typeof json.url === "string" ? json.url : "";
  } catch {
    return "";
  }
}

export function OpenClawSettings({ provider, update }: AgentSettingsProps) {
  const setState = useSetProvidersState();
  const [code, setCode] = useState("");
  const [useToken, setUseToken] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const {
    url: savedUrl,
    pairingRequest: openclawPairingRequest,
    fullAccess: openclawFullAccess,
    owner: openclawOwner,
  } = provider.settings as ProviderSnapshot["settings"] & {
    url: string;
    pairingRequest: string | null;
    fullAccess: { allowed: boolean | null; request: string | null };
    owner: boolean | null;
  };
  const [asking, setAsking] = useState(false);
  const connected = provider.status === "ready";
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;
  const host = gatewayHost(url || setupCodeUrl(code) || savedUrl);

  useEffect(() => {
    if (!openclawPairingRequest) return;
    const timer = setInterval(
      () => void mailApi.refreshAgentProviders(provider.id).catch(() => {}),
      4000,
    );
    return () => clearInterval(timer);
  }, [openclawPairingRequest, provider.id]);

  const allowFullAccess = async () => {
    setAsking(true);
    try {
      setState(await openClawApi.agentAllowOpenClawFullAccess(provider.id));
    } catch (error) {
      toast.error(
        `Could not ask the gateway: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setAsking(false);
    }
  };

  const allowOwner = async () => {
    setAsking(true);
    try {
      setState(await openClawApi.agentAllowOpenClawOwner(provider.id));
    } catch (error) {
      toast.error(
        `Could not change the gateway's settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setAsking(false);
    }
  };

  const connect = async () => {
    const address = url.trim() || savedUrl;
    if (useToken ? !address || !token.trim() : !code.trim()) {
      toast.error(useToken ? "Gateway address and token are both required" : "Paste a setup code");
      return;
    }
    setSaving(true);
    console.log("[Settings:connectOpenClaw]", useToken ? "token" : "setup code");
    try {
      setState(
        await openClawApi.connectOpenClaw(
          provider.id,
          useToken ? { url: address, token: token.trim() } : { code: code.trim() },
        ),
      );
      setCode("");
      setUrl("");
      setToken("");
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
                <TextInput
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
                <TextInput
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
              <TextInput
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
            <Btn size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : savedUrl ? "Reconnect" : "Connect"}
            </Btn>
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
                : `This ${device} was paired with less than OpenClaw's own apps have, so the agent won't use your devices (its nodes tool) for what you ask here, and its questions may not reach you. Allowing it asks the gateway for full access, and you approve it there.`
            }
            control={
              openclawFullAccess.request ? null : (
                <Btn size="sm" disabled={asking} onClick={() => void allowFullAccess()}>
                  {asking ? "Asking…" : "Allow"}
                </Btn>
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
              <Btn size="sm" disabled={asking} onClick={() => void allowOwner()}>
                {asking ? "Allowing…" : "Allow"}
              </Btn>
            }
          />
        ) : null}
      </SettingsSection>
      {connected ? <OpenClawDeliveries /> : null}
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
