import type { AgentChannel } from "@otter-mail/contracts/relay";
import {
  Command,
  SettingsGroup,
  SwiftUI,
  SwiftUIModifiers,
  errorText,
  invoke,
  type Palette,
} from "@otter-mail/mobile/extension-kit";
import { useCallback, useEffect, useState } from "react";

const { Button, LabeledContent, Text, VStack } = SwiftUI;
const { disabled, font, foregroundStyle } = SwiftUIModifiers;

const PLUGIN = "@otterware/openclaw-otter";

/** ui/deliveries.tsx on the phone: lets the gateway send what its agents deliver to Otter. */
export function OpenClawDeliveries({ colors, signedIn }: { colors: Palette; signedIn: boolean }) {
  const [channels, setChannels] = useState<AgentChannel[] | null>(null);
  const [made, setMade] = useState<{ token: string; relayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      invoke<{ channels: AgentChannel[] }>("agent:channels").then(
        ({ channels }) => setChannels(channels),
        (e: unknown) => setError(errorText(e)),
      ),
    [],
  );
  useEffect(() => {
    if (signedIn) void load();
  }, [load, signedIn]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setMade(
        await invoke<{ token: string; relayUrl: string }>("agent:makeChannel", {
          label: "OpenClaw",
        }),
      );
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await invoke("agent:deleteChannel", { id });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <SettingsGroup
      colors={colors}
      title="Messages from your agents"
      footer={
        <Text>
          What OpenClaw sends to Otter (a scheduled job's result, an approval it waits on) shows up
          here as a chat with that agent, and notifies you. It stays on your gateway: Otter's relay
          only tells your devices there's something new.
        </Text>
      }
    >
      {!signedIn ? (
        <Text modifiers={[foregroundStyle(colors.secondary)]}>
          Sign in to your Otter account. Your devices hear about new messages through it.
        </Text>
      ) : (
        <>
          {channels?.map((c) => (
            <LabeledContent
              key={c.id}
              label={
                <VStack alignment="leading" spacing={2}>
                  <Text>{c.label}</Text>
                  <Text
                    modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.secondary)]}
                  >
                    {c.lastUsedAt
                      ? `Last sent ${new Date(c.lastUsedAt).toLocaleString()}`
                      : "Nothing sent yet"}
                  </Text>
                </VStack>
              }
            >
              <Button label="Remove" role="destructive" onPress={() => void remove(c.id)} />
            </LabeledContent>
          ))}
          {made ? (
            <>
              <Text
                modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.secondary)]}
              >
                Run these on the gateway's computer. The token is shown only now. Then send a job
                here with --announce --channel otter --to inbox.
              </Text>
              <Command colors={colors} value={`openclaw plugins install ${PLUGIN}`} />
              <Command
                colors={colors}
                value={`openclaw config set channels.otter '${JSON.stringify({
                  relayUrl: made.relayUrl,
                  token: made.token,
                })}'`}
              />
              <Command
                colors={colors}
                value="openclaw cron edit <job> --announce --channel otter --to inbox"
              />
            </>
          ) : (
            <Button
              label={busy ? "Setting up…" : channels?.length ? "Set up another gateway" : "Set up"}
              onPress={() => void make()}
              modifiers={[disabled(busy)]}
            />
          )}
        </>
      )}
      {error ? <Text modifiers={[foregroundStyle(colors.error)]}>{error}</Text> : null}
    </SettingsGroup>
  );
}
