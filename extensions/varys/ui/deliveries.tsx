import { searchableSetting } from "@otter/web/extension-kit";
import { Button } from "@otter/ui/components/button";

import { useVarysRelay, type RelayState } from "../shared/connect";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";

/** Whether varys tells your devices there's something new while Otter is closed (`RelayState`). */
export function VarysDeliveries({ agent, relay }: { agent: string; relay: RelayState }) {
  const { busy, turnOn } = useVarysRelay(agent);

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
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void turnOn()}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
          }
        />
      )}
    </SettingsSection>
  );
}
