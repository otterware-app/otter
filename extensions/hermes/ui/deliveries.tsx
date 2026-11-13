import {
  Btn,
  Command,
  SettingsRow,
  SettingsSection,
  searchableSetting,
  toast,
} from "@otter/web/extension-kit";
import { useCallback, useEffect, useState } from "react";

import { channelApi, type AgentChannel } from "./api";

export const PLUGIN_INSTALL =
  "hermes plugins install otterware-app/otter/extensions/hermes/gateway --enable --yes-deps";

/**
 * Lets this Hermes send to Otter, as one of its platforms (extensions/hermes/gateway), with a
 * channel named for it.
 */
export function HermesDeliveries({ name }: { name: string }) {
  const [channels, setChannels] = useState<AgentChannel[] | null>(null);
  const [made, setMade] = useState<{ token: string; relayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(
    () =>
      channelApi.list().then(
        ({ channels }) => setChannels(channels.filter((c) => c.label === name)),
        () => setSignedOut(true),
      ),
    [name],
  );
  useEffect(() => void load(), [load]);

  const make = async () => {
    setBusy(true);
    try {
      setMade(await channelApi.make(name));
      await load();
    } catch (error) {
      toast.error(`Could not set it up: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await channelApi.remove(id);
      await load();
    } catch (error) {
      toast.error(`Could not remove it: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <SettingsSection
      {...searchableSetting("hermes-deliveries")}
      title={`Messages from ${name}`}
      description="With Otter's plugin, Otter is one of Hermes's platforms: what it sends here (a scheduled task's result, a message from its send_message tool) shows up at once as a chat, and notifies you. It stays on Hermes: Otter's relay only tells your devices there's something new."
    >
      {signedOut ? (
        <SettingsRow
          title="Sign in to your Otter account"
          description="Your devices hear about new messages through it."
        />
      ) : (
        <>
          {channels?.map((c) => (
            <SettingsRow
              key={c.id}
              title={c.label}
              description={
                c.lastUsedAt
                  ? `Last sent ${new Date(c.lastUsedAt).toLocaleString()}`
                  : "Nothing sent yet"
              }
              control={
                <Btn size="sm" onClick={() => void remove(c.id)}>
                  Remove
                </Btn>
              }
            />
          ))}
          {made ? (
            <SettingsRow
              title="Run these where Hermes runs"
              description="The token is shown only now. Then a scheduled task can send its results to Otter (deliver: otter), and Hermes can message you here."
            >
              <Command value={PLUGIN_INSTALL} />
              <Command value={`hermes config set OTTER_RELAY_URL ${made.relayUrl}`} />
              <Command value={`hermes config set OTTER_CHANNEL_TOKEN ${made.token}`} />
              <Command value="hermes gateway restart" />
            </SettingsRow>
          ) : (
            <SettingsRow
              title={channels?.length ? "Set up again" : "Set up"}
              description="Makes a token for Hermes, and shows what to run there."
              control={
                <Btn size="sm" variant="primary" disabled={busy} onClick={() => void make()}>
                  {busy ? "Setting up…" : "Set up"}
                </Btn>
              }
            />
          )}
        </>
      )}
    </SettingsSection>
  );
}
