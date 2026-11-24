import { useState } from "react";
import { useSetProvidersState } from "@otter/client/agents/agent-providers";
import type { ProviderSnapshot } from "@otter/client/agents/api";
import { host } from "@otter/client/host";
import { varysApi } from "./api";

/**
 * Whether varys can tell your devices there's something new while Otter is closed: this
 * device's grant names Otter's relay, which hears which thread to read, never what's in it.
 */
export type RelayState = "on" | "off" | "signedOut";

/** varys's settings as core shows them. */
export function varysSettings(provider: ProviderSnapshot) {
  return provider.settings as ProviderSnapshot["settings"] & { address: string; relay: RelayState };
}

const failed = (what: string, error: unknown) =>
  host().notice({
    tone: "error",
    title: `${what}: ${error instanceof Error ? error.message : String(error)}`,
  });

/**
 * Pairing this device with varys: by its pairing link, or its address and an app code
 * (`useCode`); and disconnecting, which ends this device's access there.
 */
export function useVarysConnection(provider: ProviderSnapshot) {
  const setState = useSetProvidersState();
  const [link, setLink] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  const disconnect = async () => {
    setSaving(true);
    try {
      const { state, notice } = await varysApi.disconnectVarys(provider.id);
      setState(state);
      if (notice) host().notice({ tone: "warning", title: notice });
    } catch (error) {
      failed("Could not disconnect", error);
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    if (useCode ? !address.trim() || !code.trim() : !link.trim()) {
      host().notice({
        tone: "error",
        title: useCode ? "varys's address and the code are both required" : "Paste a pairing link",
      });
      return;
    }
    setSaving(true);
    console.log("[Settings:connectVarys]", useCode ? "code" : "link");
    try {
      setState(
        await varysApi.connectVarys(
          provider.id,
          useCode ? { address: address.trim(), code: code.trim() } : { link: link.trim() },
        ),
      );
      setLink("");
      setAddress("");
      setCode("");
    } catch (error) {
      failed("Could not connect", error);
    } finally {
      setSaving(false);
    }
  };

  return {
    settings: varysSettings(provider),
    connected: provider.status === "ready",
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
  };
}

/** Gives varys Otter's relay, when it didn't take it on connecting. */
export function useVarysRelay(agent: string) {
  const setState = useSetProvidersState();
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      setState(await varysApi.varysRelay(agent));
    } catch (error) {
      failed("Could not turn it on", error);
    } finally {
      setBusy(false);
    }
  };
  return { busy, turnOn };
}
