import { useState } from "react";
import { useSetProvidersState } from "@otter/client/agents/agent-providers";
import type { ProviderSnapshot } from "@otter/client/agents/api";
import { host } from "@otter/client/host";
import { hermesApi } from "./api";

/** Hermes' settings as core shows them (its key never leaves the backend: only whether there is one). */
export function hermesSettings(provider: ProviderSnapshot) {
  return provider.settings as ProviderSnapshot["settings"] & { baseUrl: string; hasKey: boolean };
}

/** It has an address and a key. */
export const hermesConnected = (provider: ProviderSnapshot) => {
  const settings = hermesSettings(provider);
  return Boolean(settings.baseUrl && settings.hasKey);
};

/** Connecting to a Hermes server: its address (the saved one when left empty) and API key, checked against it. */
export function useConnectHermes(provider: ProviderSnapshot) {
  const setState = useSetProvidersState();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const connect = async (): Promise<boolean> => {
    const url = baseUrl.trim() || hermesSettings(provider).baseUrl;
    if (!url || !apiKey.trim()) {
      host().notice({ tone: "error", title: "API base URL and key are both required" });
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
      host().notice({ tone: "success", title: `${provider.name} connected` });
      return true;
    } catch (error) {
      host().notice({
        tone: "error",
        title: `Could not connect: ${error instanceof Error ? error.message : String(error)}`,
      });
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { baseUrl, setBaseUrl, apiKey, setApiKey, saving, connect };
}

/** Its plugin, which makes Otter one of Hermes's platforms. */
export const PLUGIN_INSTALL =
  "hermes plugins install otterware-app/otter/extensions/hermes/gateway --enable --yes-deps";

/** What to run where Hermes runs, once a channel is made for it. */
export const deliveryCommands = (made: { token: string; relayUrl: string }) => [
  PLUGIN_INSTALL,
  `hermes config set OTTER_RELAY_URL ${made.relayUrl}`,
  `hermes config set OTTER_CHANNEL_TOKEN ${made.token}`,
  "hermes gateway restart",
];
