import {
  Btn,
  SettingsRow,
  SettingsSection,
  searchableSetting,
  toast,
  useSetProvidersState,
} from "@otter/web/extension-kit";
import { useState } from "react";

import { varysApi } from "./api";

export type RelayState = "on" | "off" | "signedOut";

/**
 * Whether varys can tell your devices there's something new while Otter is closed: this
 * device's grant names Otter's relay, which hears which thread to read, never what's in it.
 */
export function VarysDeliveries({ agent, relay }: { agent: string; relay: RelayState }) {
  const setState = useSetProvidersState();
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    try {
      setState(await varysApi.varysRelay(agent));
    } catch (error) {
      toast.error(
        `Could not turn it on: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      {...searchableSetting("varys-deliveries")}
      title="Messages from varys"
      description="While Otter is open, what varys does shows up at once. Through Otter's relay, varys also tells your devices when there's something new while it's closed: a routine's report, an approval, a question, a finished run. It stays in varys: the relay only hears which thread to read."
    >
      {relay === "signedOut" ? (
        <SettingsRow
          title="Sign in to your Otter account"
          description="Your devices hear about new messages through it."
        />
      ) : relay === "on" ? (
        <SettingsRow
          title="On"
          description="varys shows it on this device's page in Settings → Sharing & access, with how telling the relay went."
        />
      ) : (
        <SettingsRow
          title="Off"
          description="varys didn't take Otter's relay when this device connected."
          control={
            <Btn size="sm" variant="primary" disabled={busy} onClick={() => void turnOn()}>
              {busy ? "Turning on…" : "Turn on"}
            </Btn>
          }
        />
      )}
    </SettingsSection>
  );
}
