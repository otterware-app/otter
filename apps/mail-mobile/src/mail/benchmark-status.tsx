import { mailApi } from "@otter/client/mail/api";
import type { SyncStatus } from "@otter/client/mail/types";
import { appFiles } from "@otter/mobile/files";
import { longestSqlite, longTasks } from "@otter/mobile/long-tasks";
import { startup } from "@otter/mobile/start";
import { Button } from "@otter/ui-native/components/button";
import { Text } from "@otter/ui-native/components/text";
import { useEffect, useState } from "react";
import { View } from "react-native";

type Blocks = ReturnType<typeof longTasks> & { sqlite?: ReturnType<typeof longestSqlite> };
type FirstSync = { firstRowMs: number; firstSync: Blocks; rowsVisible: Blocks };
type Replay = { changes: number; ms: number } & Blocks;

/** Where `pnpm bench:mobile:mail` reads the results, in the app's documents. */
const RESULT = "benchmark-result.json";
const SCROLL_EVERY_MS = 1000;
const SCROLL_STEP = 2400;
const SCROLL_STEPS = 10;

function blocks(from: number): Blocks {
  return { ...longTasks(from), sqlite: longestSqlite(from) };
}

function firstSyncText({ firstRowMs, firstSync: all, rowsVisible: visible }: FirstSync) {
  const sql = all.sqlite;
  return `First row ${firstRowMs} ms · max ${all.longest} ms at ${all.longestAt ?? 0} ms · p95 ${all.p95} ms\nJS CPU · ${all.cpuAtLongest ?? 0} ms at max delay · max ${all.longestCpu} ms\nWhile rows were visible · max ${visible.longest} ms · p95 ${visible.p95} ms${sql ? `\nSQLite ${sql.operation} · ${sql.ms} ms at ${sql.at - startup.launchedAt} ms` : ""}`;
}

function replayText(replay: Replay) {
  const sql = replay.sqlite;
  return `${replay.changes} changes · ${replay.ms} ms · max ${replay.longest} ms · p95 ${replay.p95} ms · CPU ${replay.cpuAtLongest ?? 0} ms at max delay / ${replay.longestCpu} ms peak${sql ? ` · SQLite ${sql.operation} ${sql.ms} ms` : ""}`;
}

/**
 * `scrollTo`: the automatic benchmark's (`autoBenchmark`). The list then scrolls on its own until
 * the end, the replay starts when first sync finishes, and the results are written to `RESULT`.
 */
export function BenchmarkStatus({
  accountId,
  status,
  scrollTo,
}: {
  accountId: string;
  status: SyncStatus | null;
  scrollTo?: (offset: number) => void;
}) {
  const [result, setResult] = useState<FirstSync>();
  const [replay, setReplay] = useState<string>();
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const complete = status?.fullSyncDone && !status.syncing;
  useEffect(() => {
    if (!complete || result || !startup.listShownAt) return;
    const timer = setTimeout(() =>
      setResult({
        firstRowMs: startup.listShownAt - startup.launchedAt,
        firstSync: blocks(startup.launchedAt),
        rowsVisible: blocks(startup.listShownAt),
      }),
    );
    return () => clearTimeout(timer);
  }, [complete, result]);

  useEffect(() => {
    if (!scrollTo || finished) return;
    let step = 0;
    const timer = setInterval(() => {
      step = (step + 1) % SCROLL_STEPS;
      scrollTo(step * SCROLL_STEP);
    }, SCROLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [scrollTo, finished]);

  useEffect(() => {
    if (!scrollTo || !result) return;
    void runReplay().then(async (measured) => {
      const json = JSON.stringify({ ...result, ...measured }, null, 2);
      await appFiles("fake-mail-benchmark").write(RESULT, new TextEncoder().encode(json));
      setFinished(true);
    });
  }, [result]);

  async function runReplay(): Promise<{ replay: Replay } | { error: string }> {
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
      const measured = { changes: 200, ms: Date.now() - start, ...blocks(start) };
      setReplay(replayText(measured));
      return { replay: measured };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReplay(message);
      return { error: message };
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 5 }}>
      <Text size="sm" color="mutedForeground" accessibilityLiveRegion="polite">
        {result
          ? firstSyncText(result)
          : `Syncing benchmark mailbox · ${status?.synced ?? 0} messages cached`}
      </Text>
      {result && !scrollTo && (
        <Button title="Replay 200 changes" disabled={running || !complete} onPress={runReplay} />
      )}
      {replay && <Text size="sm">{replay}</Text>}
    </View>
  );
}
