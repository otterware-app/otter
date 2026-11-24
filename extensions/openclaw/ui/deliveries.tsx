import { Command, searchableSetting } from "@otter/web/extension-kit";
import { channelLastSent, useAgentChannels } from "@otter/client/agents/agent-channels";
import { Button } from "@otter/ui/components/button";

import { deliveryCommands } from "../shared/connect";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";

/** Lets the gateway send what its agents deliver to Otter (extensions/openclaw/gateway). */
export function OpenClawDeliveries() {
  const { channels, made, busy, signedOut, make, remove } = useAgentChannels(
    "OpenClaw",
    (c) => c.label !== "Hermes",
  );

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
              description={channelLastSent(c)}
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
              {deliveryCommands(made).map((command) => (
                <Command key={command} value={command} />
              ))}
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
