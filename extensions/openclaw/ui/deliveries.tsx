import { Command, searchableSetting } from "@otter/web/extension-kit";
import { toast } from "@otter/ui/components/toast";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@otter/ui/components/button";

import { channelApi, type AgentChannel } from "./api";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";

const PLUGIN = "@otterware/openclaw-otter";

/** Lets the gateway send what its agents deliver to Otter (extensions/openclaw/gateway). */
export function OpenClawDeliveries() {
  const [channels, setChannels] = useState<AgentChannel[] | null>(null);
  const [made, setMade] = useState<{ token: string; relayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(
    () =>
      channelApi.list().then(
        ({ channels }) => setChannels(channels.filter((c) => c.label !== "Hermes")),
        () => setSignedOut(true),
      ),
    [],
  );
  useEffect(() => void load(), [load]);

  const make = async () => {
    setBusy(true);
    try {
      const result = await channelApi.make("OpenClaw");
      setMade(result);
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
      {...searchableSetting("openclaw-deliveries")}
      title="Messages from your agents"
      description="What OpenClaw sends to Otter (a scheduled job's result, an approval it waits on) shows up here as a chat with that agent, and notifies you. It stays on your gateway: Otter's relay only tells your devices there's something new."
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
                <Button size="sm" onClick={() => void remove(c.id)}>
                  Remove
                </Button>
              }
            />
          ))}
          {made ? (
            <SettingsRow
              title="Run these on the gateway's computer"
              description="The token is shown only now. Then send a job here with --announce --channel otter --to chat:new (a new chat each time), or --to chat:<session key> for one chat."
            >
              <Command value={`openclaw plugins install ${PLUGIN}`} />
              <Command
                value={`openclaw config set channels.otter '${JSON.stringify({
                  relayUrl: made.relayUrl,
                  token: made.token,
                })}'`}
              />
              <Command value="openclaw cron edit <job> --announce --channel otter --to chat:new" />
            </SettingsRow>
          ) : (
            <SettingsRow
              title={channels?.length ? "Set up another gateway" : "Set up"}
              description="Makes a token for the gateway, and shows what to run there."
              control={
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void make()}>
                  {busy ? "Setting up…" : "Set up"}
                </Button>
              }
            />
          )}
        </>
      )}
    </SettingsSection>
  );
}
