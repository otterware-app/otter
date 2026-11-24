import { mailApi } from "@otter/client/mail/api";
import type { SyncStatus } from "@otter/client/mail/types";
import { longTasks } from "@otter/mobile/long-tasks";
import { startup } from "@otter/mobile/start";
import { Button } from "@otter/ui-native/components/button";
import { Text } from "@otter/ui-native/components/text";
import { useEffect, useState } from "react";
import { View } from "react-native";

export function BenchmarkStatus({
  accountId,
  status,
}: {
  accountId: string;
  status: SyncStatus | null;
}) {
  const [result, setResult] = useState<string>();
  const [replay, setReplay] = useState<string>();
  const [running, setRunning] = useState(false);
  const complete = status?.fullSyncDone && !status.syncing;
  useEffect(() => {
    if (!complete || result || !startup.listShownAt) return;
    const timer = setTimeout(() => {
      const { longest, longestAt, p95 } = longTasks(startup.launchedAt);
      const visible = longTasks(startup.listShownAt);
      setResult(
        `First row ${startup.listShownAt - startup.launchedAt} ms · max ${longest} ms at ${longestAt ?? 0} ms · p95 ${p95} ms\nWhile rows were visible · max ${visible.longest} ms · p95 ${visible.p95} ms`,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [complete, result]);

  async function runReplay() {
    setRunning(true);
    setReplay("Preparing 200 fake Gmail changes…");
    try {
      const { stageLargeGmailChanges } = await import("@otter/core/fake");
      const { revision } = await mailApi.getSyncStatus(accountId);
      await stageLargeGmailChanges(accountId, 200);
      setReplay("Replaying 200 changes…");
      const start = Date.now();
      let current = await mailApi.syncAccount(accountId);
      while (current.syncing || current.revision <= revision) {
        if (current.error) throw new Error(current.error);
        if (Date.now() - start > 60_000) throw new Error("History sync timed out.");
        await new Promise((resolve) => setTimeout(resolve, 50));
        current = await mailApi.getSyncStatus(accountId);
      }
      if (current.error) throw new Error(current.error);
      const { longest, p95 } = longTasks(start);
      setReplay(`200 changes · ${Date.now() - start} ms · max ${longest} ms · p95 ${p95} ms`);
    } catch (error) {
      setReplay(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 5 }}>
      <Text size="sm" color="mutedForeground" accessibilityLiveRegion="polite">
        {result ?? `Syncing benchmark mailbox · ${status?.synced ?? 0} messages cached`}
      </Text>
      {result && (
        <Button title="Replay 200 changes" disabled={running || !complete} onPress={runReplay} />
      )}
      {replay && <Text size="sm">{replay}</Text>}
    </View>
  );
}
