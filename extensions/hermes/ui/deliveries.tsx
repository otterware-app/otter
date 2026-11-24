import { Command, searchableSetting } from "@otter/web/extension-kit";
import { channelLastSent, useAgentChannels } from "@otter/client/agents/agent-channels";
import { Button } from "@otter/ui/components/button";

import { deliveryCommands } from "../shared/connect";
import { SettingsRow, SettingsSection } from "@otter/ui/components/settings";

/**
 * Lets this Hermes send to Otter, as one of its platforms (extensions/hermes/gateway), with a
 * channel named for it.
 */
export function HermesDeliveries({ name }: { name: string }) {
  const { channels, made, busy, signedOut, make, remove } = useAgentChannels(
    name,
    (c) => c.label === name,
  );

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
              title="Run these where Hermes runs"
              description="The token is shown only now. Then a scheduled task can send its results to Otter (deliver: otter), and Hermes can message you here."
            >
              {deliveryCommands(made).map((command) => (
                <Command key={command} value={command} />
              ))}
            </SettingsRow>
          ) : (
            <SettingsRow
              title={channels?.length ? "Set up again" : "Set up"}
              description="Makes a token for Hermes, and shows what to run there."
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
