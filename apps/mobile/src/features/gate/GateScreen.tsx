import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import type { RootStack } from "../../App";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";

import { connection } from "../../state/core";
import { probe } from "../../state/mail";
import { startup } from "../../state/startup";
import { ThreadRow } from "../home/ThreadRow";
import { palette } from "../theme";

const host = createWorkerHost();
const PROBES = ["boot", "nitro", "sqlite", "charsets", "imap", "memory"] as const;
const NET_BASE = "http://localhost:8790";

function log(name: string, value: unknown) {
  host.log("info", `[gate] ${name}: ${JSON.stringify(value)}`);
}

/**
 * Phase 0's gate, run on the device: each probe runs on core's worker runtime
 * and reports numbers here and to the system log (`[gate] …`). Deep link
 * `ottermail-dev://gate?run=all|scroll|net` runs them unattended.
 */
export function GateScreen({ route }: NativeStackScreenProps<RootStack, "Gate">) {
  const colors = palette(useColorScheme());
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [bench, setBench] = useState<MessageSummary[] | null>(null);
  const runProbe = useCallback(async (name: string, args?: unknown) => {
    const value = await probe(name, args).catch((error: unknown) => ({ error: String(error) }));
    log(name, value);
    setResults((r) => ({ ...r, [name]: value }));
    return value;
  }, []);

  const runAll = useCallback(async () => {
    const channels = await connection.ready().catch(() => []);
    const started = { startup, channels: channels.length };
    log("startup", started);
    setResults((r) => ({ ...r, startup: started }));
    for (const name of PROBES) await runProbe(name);
  }, [runProbe]);

  const runNet = useCallback(async () => {
    await runProbe("net:start", { base: NET_BASE });
  }, [runProbe]);

  const startScroll = useCallback(async () => {
    const list = (await runProbe("bench:list")) as { ms: number; rows: MessageSummary[] };
    setResults((r) => ({ ...r, "bench:list": { ms: list.ms, rows: list.rows.length } }));
    setBench(list.rows);
  }, [runProbe]);

  // A deep link runs a probe once per link (`n` tells repeats apart), not when callbacks change.
  const { run, n } = route.params ?? {};
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const key = `${run}:${n}`;
    if (!run || handled.current === key) return;
    handled.current = key;
    if (run === "all") void runAll();
    else if (run === "scroll") void startScroll();
    else if (run === "net") void runNet();
    else if (run === "net-status") void runProbe("net:status");
    else void runProbe(run);
  }, [run, n, runAll, startScroll, runNet, runProbe]);

  if (bench) {
    return (
      <ScrollBench
        rows={bench}
        onDone={(result) => {
          log("scroll", result);
          setResults((r) => ({ ...r, scroll: result }));
          setBench(null);
        }}
        startChurn={() => runProbe("bench:churn", { seconds: 12 })}
        churnStatus={() => runProbe("bench:churnStatus")}
      />
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      testID="gate"
    >
      <View style={styles.buttons}>
        <Button label="Run all" onPress={runAll} testID="gate-run-all" />
        <Button label="Scroll 5k" onPress={startScroll} testID="gate-scroll" />
        <Button label="Net start" onPress={runNet} testID="gate-net" />
        <Button
          label="Net status"
          onPress={() => runProbe("net:status")}
          testID="gate-net-status"
        />
      </View>
      <Text selectable style={[styles.json, { color: colors.text }]} testID="gate-results">
        {JSON.stringify(results, null, 1)}
      </Text>
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const colors = palette(useColorScheme());
  return (
    <Pressable
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.card }]}
      testID={testID}
    >
      <Text style={{ color: colors.accent, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Scrolls 5,000 threads at 2,400 pt/s for 10 s while the worker writes a
 * sync's worth of mail, timing every JS frame (a frame over 25 ms is dropped
 * at 60 Hz).
 */
function ScrollBench({
  rows,
  onDone,
  startChurn,
  churnStatus,
}: {
  rows: MessageSummary[];
  onDone: (result: unknown) => void;
  startChurn: () => Promise<unknown>;
  churnStatus: () => Promise<unknown>;
}) {
  const ref = useRef<LegendListRef>(null);
  useEffect(() => {
    let cancelled = false;
    void startChurn();
    const frames: number[] = [];
    let offset = 0;
    let last = 0;
    const started = performance.now();
    const step = (time: number) => {
      if (cancelled) return;
      if (last) frames.push(time - last);
      last = time;
      offset += 40;
      ref.current?.scrollToOffset({ offset, animated: false });
      if (time - started < 10_000) requestAnimationFrame(step);
      else void finish();
    };
    const finish = async () => {
      const total = frames.length;
      const dropped = frames.filter((d) => d > 25).length;
      const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, total);
      const sorted = [...frames].sort((a, b) => a - b);
      onDone({
        frames: total,
        fps: Math.round((1000 / avg) * 10) / 10,
        dropped,
        droppedPct: Math.round((dropped / Math.max(1, total)) * 1000) / 10,
        p95Ms: Math.round(sorted[Math.floor(total * 0.95)] ?? 0),
        maxMs: Math.round(sorted[total - 1] ?? 0),
        scrolledPt: offset,
        churn: await churnStatus(),
      });
    };
    const timer = setTimeout(() => requestAnimationFrame(step), 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // One run per mount: the callbacks are the parent's inline props, new every render.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, []);
  return (
    <LegendList
      ref={ref}
      data={rows}
      keyExtractor={(row) => row.id}
      renderItem={({ item }) => <ThreadRow row={item} accountId={item.accountId ?? ""} />}
      estimatedItemSize={76}
      recycleItems
      testID="bench-list"
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  json: { fontFamily: "Menlo", fontSize: 11 },
});
