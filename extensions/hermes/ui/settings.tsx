import {
  Btn,
  Command,
  ModelsSection,
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

import { hermesApi } from "./api";
import { HermesDeliveries } from "./deliveries";

/** Hermes' settings as core shows them (its key never leaves the backend: only whether there is one). */
export function hermesSettings(provider: ProviderSnapshot) {
  return provider.settings as ProviderSnapshot["settings"] & { baseUrl: string; hasKey: boolean };
}

const SITE_ORIGIN = window.desktopBridge.platform === "web" ? location.origin : null;

export const HERMES_URL_HINT =
  window.desktopBridge.platform === "web"
    ? `Hermes' built-in API server (port 8642), over HTTPS. Allow ${location.origin} in its API_SERVER_CORS_ORIGINS.`
    : "Hermes' built-in API server (port 8642), reached over Tailscale.";

export function useConnectHermes(provider: ProviderSnapshot) {
  const setState = useSetProvidersState();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const connect = async (): Promise<boolean> => {
    const url = baseUrl.trim() || hermesSettings(provider).baseUrl;
    if (!url || !apiKey.trim()) {
      toast.error("API base URL and key are both required");
      return false;
    }
    setSaving(true);
    console.log("[Settings:connectHermes]");
    try {
      setState(
        await hermesApi.connectHermes({ agent: provider.id, baseUrl: url, apiKey: apiKey.trim() }),
      );
      setBaseUrl("");
      setApiKey("");
      toast.success(`${provider.name} connected`);
      return true;
    } catch (error) {
      toast.error(`Could not connect: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect };
}

export function HermesSettings({ provider, update }: AgentSettingsProps) {
  const settings = hermesSettings(provider);
  const { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect } = useConnectHermes(provider);
  const connected = Boolean(settings.baseUrl && settings.hasKey);
  const device = window.desktopBridge.platform === "web" ? "browser" : osNames.computer;

  return (
    <>
      {provider.status === "ready" ? null : (
        <SettingsSection
          title="Set up"
          description={`Run these on the computer where Hermes runs. This ${device} reaches it over Tailscale, so it needs Tailscale too, on the same tailnet.`}
        >
          <SettingsRow
            title="1. Turn on its API server"
            description="Skip this if Hermes already serves its API on port 8642. This makes a new key."
          >
            <Command value="hermes config set API_SERVER_ENABLED true" />
            <Command value={'hermes config set API_SERVER_KEY "$(openssl rand -hex 32)"'} />
            <Command value="hermes gateway restart" />
          </SettingsRow>
          <SettingsRow
            title="2. Serve it on your tailnet"
            description="Its address becomes https://<computer>.<tailnet>.ts.net:8642."
          >
            <Command value="tailscale serve --bg --https=8642 http://127.0.0.1:8642" />
          </SettingsRow>
          <SettingsRow title="3. Copy the API key" description="Paste it below with the address.">
            <Command value={`sed -n 's/^API_SERVER_KEY=//p' "$(hermes config env-path)"`} />
          </SettingsRow>
          {SITE_ORIGIN ? (
            <SettingsRow
              title="4. Allow Otter on the web"
              description="Browsers may only call Hermes from sites it allows. Separate sites with commas, and keep any you allowed before."
            >
              <Command value={`hermes config set API_SERVER_CORS_ORIGINS ${SITE_ORIGIN}`} />
              <Command value="hermes gateway restart" />
            </SettingsRow>
          ) : null}
        </SettingsSection>
      )}
      <SettingsSection {...searchableSetting("hermes-connection")}>
        <SettingsRow
          title="Base URL"
          description="Its address on your tailnet: https://<computer>.<tailnet>.ts.net:8642."
          control={
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={settings.baseUrl || "https://<host>:8642"}
              aria-label="Hermes API base URL"
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title="API key"
          description="The server's API_SERVER_KEY. It follows your Otter account to your other devices."
          control={
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.hasKey ? "Replace API key" : "API key"}
              aria-label="Hermes API key"
              className="@min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title={connected ? "Reconnect" : "Connect"}
          description="Verifies the URL and key against the server, then saves them."
          control={
            <Btn size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : connected ? "Reconnect" : "Connect"}
            </Btn>
          }
        />
      </SettingsSection>
      {connected && provider.status === "ready" ? <HermesDeliveries name={provider.name} /> : null}
      <ModelsSection
        provider={provider}
        selectedModel={settings.model}
        onPick={(model) => update({ [provider.id]: { model } })}
      />
    </>
  );
}

export function HermesConnect({
  provider,
  onConnected,
}: {
  provider: ProviderSnapshot;
  onConnected: () => void;
}) {
  const { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect } = useConnectHermes(provider);
  return (
    <form
      className="flex flex-col gap-2 px-3.5 pb-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void connect().then((ok) => ok && onConnected());
      }}
    >
      <TextInput
        autoFocus
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={hermesSettings(provider).baseUrl || "https://<host>:8642"}
        aria-label="Hermes API base URL"
      />
      <TextInput
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API key (API_SERVER_KEY)"
        aria-label="Hermes API key"
      />
      <p className="text-xs leading-[17px] text-muted-foreground">
        {HERMES_URL_HINT} The key stays on this device.
      </p>
      <Btn type="submit" size="sm" variant="primary" disabled={saving} className="self-end">
        {saving ? "Connecting…" : "Connect"}
      </Btn>
    </form>
  );
}
