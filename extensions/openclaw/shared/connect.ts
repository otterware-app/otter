import { useEffect, useState } from "react";
import { disabledAgents, useSetProvidersState } from "@otter/client/agents/agent-providers";
import { agentApi, type AgentSettingsPatch, type ProviderSnapshot } from "@otter/client/agents/api";
import { host } from "@otter/client/host";
import { openClawApi } from "./api";

/** OpenClaw's settings as core shows them. */
export function openClawSettings(provider: ProviderSnapshot) {
  return provider.settings as ProviderSnapshot["settings"] & {
    url: string;
    /** The device request the gateway waits on you to approve. */
    pairingRequest: string | null;
    fullAccess: { allowed: boolean | null; request: string | null };
    owner: boolean | null;
  };
}

/**
 * Turns one of the gateway's agents on or off, for the account: one that's off is still named,
 * but runs none of its chats (their messages wait) and starts none.
 */
export function gatewayAgentPatch(
  provider: ProviderSnapshot,
  agent: string,
  on: boolean,
): AgentSettingsPatch {
  const others = disabledAgents(provider).filter((id) => id !== agent);
  return { [provider.id]: { disabledAgents: on ? others : [...others, agent] } };
}

/** A gateway's host, from an address typed in any form. */
export const gatewayHost = (address: string) =>
  address
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "");

/** The gateway address a setup code holds, or "". */
export function setupCodeUrl(code: string): string {
  try {
    const json = JSON.parse(atob(code.trim().replace(/-/g, "+").replace(/_/g, "/"))) as {
      url?: unknown;
    };
    return typeof json.url === "string" ? json.url : "";
  } catch {
    return "";
  }
}

const failed = (what: string, error: unknown) =>
  host().notice({
    tone: "error",
    title: `${what}: ${error instanceof Error ? error.message : String(error)}`,
  });

/**
 * Connecting this device to an OpenClaw gateway: by a setup code, or its address and token
 * (`useToken`). While the gateway waits on you to approve the device, it's checked again every
 * few seconds. Once connected, it can be asked for full access and to list Otter as an owner.
 */
export function useOpenClawConnection(provider: ProviderSnapshot) {
  const setState = useSetProvidersState();
  const [code, setCode] = useState("");
  const [useToken, setUseToken] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const settings = openClawSettings(provider);
  const pairingRequest = settings.pairingRequest;

  useEffect(() => {
    if (!pairingRequest) return;
    const timer = setInterval(
      () => void agentApi.refreshProviders(provider.id).catch(() => {}),
      4000,
    );
    return () => clearInterval(timer);
  }, [pairingRequest, provider.id]);

  const ask = async (request: () => Promise<Parameters<typeof setState>[0]>, what: string) => {
    setAsking(true);
    try {
      setState(await request());
    } catch (error) {
      failed(what, error);
    } finally {
      setAsking(false);
    }
  };

  const connect = async () => {
    const address = url.trim() || settings.url;
    if (useToken ? !address || !token.trim() : !code.trim()) {
      host().notice({
        tone: "error",
        title: useToken ? "Gateway address and token are both required" : "Paste a setup code",
      });
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
      failed("Could not connect", error);
    } finally {
      setSaving(false);
    }
  };

  return {
    settings,
    connected: provider.status === "ready",
    /** The gateway's host, as far as it's known: typed, in the setup code, or saved. */
    host: gatewayHost(url || setupCodeUrl(code) || settings.url),
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
    allowFullAccess: () =>
      ask(() => openClawApi.agentAllowOpenClawFullAccess(provider.id), "Could not ask the gateway"),
    allowOwner: () =>
      ask(
        () => openClawApi.agentAllowOpenClawOwner(provider.id),
        "Could not change the gateway's settings",
      ),
  };
}

/** Its plugin, which lets the gateway send to Otter. */
const PLUGIN = "@otterware/openclaw-otter";

/** What to run on the gateway's computer, once a channel is made for it. */
export const deliveryCommands = (made: { token: string; relayUrl: string }) => [
  `openclaw plugins install ${PLUGIN}`,
  `openclaw config set channels.otter '${JSON.stringify({
    relayUrl: made.relayUrl,
    token: made.token,
  })}'`,
  "openclaw cron edit <job> --announce --channel otter --to chat:new",
];
