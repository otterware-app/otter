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
} from "@otter-mail/web/extension-kit";
import { useEffect, useState } from "react";

import { openClawApi } from "./api";

const SITE_ORIGIN = window.desktopBridge.platform === "web" ? location.origin : null;

const gatewayHost = (address: string) =>
  address
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[/:].*$/, "");

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
    questions: openclawQuestions,
  } = provider.settings as ProviderSnapshot["settings"] & {
    url: string;
    pairingRequest: string | null;
    questions: { allowed: boolean | null; request: string | null };
  };
  const [asking, setAsking] = useState(false);
  const connected = provider.status === "ready";
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;
  const host = gatewayHost(url || setupCodeUrl(code) || savedUrl);

  useEffect(() => {
    if (!openclawPairingRequest) return;
    const timer = setInterval(() => void mailApi.refreshAgentProviders().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [openclawPairingRequest]);

  const allowQuestions = async () => {
    setAsking(true);
    try {
      setState(await openClawApi.agentAllowOpenClawQuestions());
    } catch (error) {
      toast.error(
        `Could not ask the gateway: ${error instanceof Error ? error.message : String(error)}`,
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
              title="2. Allow Otter Mail on the web"
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
            description={`The gateway is waiting for you to approve this ${device}. Run this on its computer; Otter Mail connects as soon as you do.`}
          >
            <Command value={`openclaw devices approve ${openclawPairingRequest}`} />
          </SettingsRow>
        ) : null}
        {connected && openclawQuestions.allowed === false ? (
          <SettingsRow
            title="Answer its questions"
            description={
              openclawQuestions.request
                ? "The gateway is waiting for you to approve it. Run this on its computer; its questions show up in the chat once you do."
                : `OpenClaw sometimes stops to ask you something. This ${device} was paired before it could answer; allowing it asks the gateway for that, and you approve it there.`
            }
            control={
              openclawQuestions.request ? null : (
                <Btn size="sm" disabled={asking} onClick={() => void allowQuestions()}>
                  {asking ? "Asking…" : "Allow"}
                </Btn>
              )
            }
          >
            {openclawQuestions.request ? (
              <Command value={`openclaw devices approve ${openclawQuestions.request}`} />
            ) : null}
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {connected ? (
        <ModelsSection
          provider={provider}
          selectedModel={provider.settings.model}
          onPick={(model) => update({ openclaw: { model } })}
        />
      ) : null}
    </>
  );
}
