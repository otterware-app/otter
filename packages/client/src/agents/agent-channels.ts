import { useCallback, useEffect, useState } from "react";
import { host } from "../host.ts";
import { useLatest } from "../use-latest.ts";
import { agentApi, type AgentChannel } from "./api.ts";

const failed = (what: string, error: unknown) =>
  host().notice({
    tone: "error",
    title: `${what}: ${error instanceof Error ? error.message : String(error)}`,
  });

/**
 * The ways in an agent's gateway sends to Otter by (its plugin's tokens): those `shows` keeps,
 * making one named `label`, and removing one. Signed out of Otter, there are none to have.
 */
export function useAgentChannels(label: string, shows: (channel: AgentChannel) => boolean) {
  const [channels, setChannels] = useState<AgentChannel[] | null>(null);
  /** The one just made, with its token, shown only now. */
  const [made, setMade] = useState<{ token: string; relayUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const showsRef = useLatest(shows);

  const load = useCallback(
    () =>
      agentApi.channels().then(
        ({ channels }) => setChannels(channels.filter((c) => showsRef.current(c))),
        () => setSignedOut(true),
      ),
    // oxlint-disable-next-line react/memo-dependencies -- Listed again for another agent's name.
    [label, showsRef],
  );
  useEffect(() => void load(), [load]);

  const make = async () => {
    setBusy(true);
    try {
      setMade(await agentApi.makeChannel(label));
      await load();
    } catch (error) {
      failed("Could not set it up", error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await agentApi.deleteChannel(id);
      await load();
    } catch (error) {
      failed("Could not remove it", error);
    }
  };

  return { channels, made, busy, signedOut, make, remove };
}

/** What a channel's row says of it: when its gateway last sent, if ever. */
export const channelLastSent = (c: AgentChannel) =>
  c.lastUsedAt ? `Last sent ${new Date(c.lastUsedAt).toLocaleString()}` : "Nothing sent yet";
