import {
  Command,
  ModelsSection,
  osNames,
  searchableSetting,
  type AgentSettingsProps,
  type ProviderSnapshot,
} from "@otter/web/extension-kit";
import { Button } from "@otter/ui/components/button";

import { hermesConnected, hermesSettings, useConnectHermes } from "../shared/connect";
import { HermesDeliveries } from "./deliveries";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { Input } from "@otter/ui/components/input";

const SITE_ORIGIN = window.desktopBridge.platform === "web" ? location.origin : null;

export const HERMES_URL_HINT =
  window.desktopBridge.platform === "web"
    ? `Hermes' built-in API server (port 8642), over HTTPS. Allow ${location.origin} in its API_SERVER_CORS_ORIGINS.`
    : "Hermes' built-in API server (port 8642), reached over Tailscale.";

export function HermesSettings({ provider, update }: AgentSettingsProps) {
  const settings = hermesSettings(provider);
  const { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect } = useConnectHermes(provider);
  const connected = hermesConnected(provider);
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
            <Input
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
            <Input
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
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void connect()}>
              {saving ? "Connecting…" : connected ? "Reconnect" : "Connect"}
            </Button>
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
      <Input
        autoFocus
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={hermesSettings(provider).baseUrl || "https://<host>:8642"}
        aria-label="Hermes API base URL"
      />
      <Input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API key (API_SERVER_KEY)"
        aria-label="Hermes API key"
      />
      <p className="text-xs leading-[17px] text-muted-foreground">
        {HERMES_URL_HINT} The key stays on this device.
      </p>
      <Button type="submit" size="sm" variant="primary" disabled={saving} className="self-end">
        {saving ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}
