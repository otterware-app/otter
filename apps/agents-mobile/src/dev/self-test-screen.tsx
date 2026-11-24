import {
  roundTripChecks,
  runChecks,
  runtimeChecks,
  type CheckResult,
} from "@otter/mobile/self-test";
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";

import { DEV_TOOLS, FAKE } from "../core";

export function SelfTestScreen() {
  if (!DEV_TOOLS) return <Redirect href="/" />;
  return <Checks />;
}

function Checks() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(true);

  const check = () =>
    void runChecks([...runtimeChecks, ...(FAKE ? roundTripChecks : [])], (result) =>
      setResults((previous) => [...previous, result]),
    ).finally(() => setRunning(false));
  useEffect(check, []);

  const failed = results.filter((r) => !r.ok && !r.gap).length;
  const gaps = results.filter((r) => r.gap).length;
  const known = gaps ? `; ${gaps} known gap${gaps > 1 ? "s" : ""}` : "";
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}>
      <Text style={styles.summary} testID="self-test-summary">
        {running
          ? `Running… ${results.length} done`
          : failed
            ? `${failed} of ${results.length - gaps} failed${known}`
            : `All ${results.length - gaps} passed${known}`}
      </Text>
      {FAKE ? null : (
        <Text style={styles.detail}>
          The round trip through core runs over the fake: pnpm dev:mobile:agents:fake.
        </Text>
      )}
      {results.map((result) => (
        <View key={result.name} style={styles.row}>
          <Text style={result.gap ? styles.gap : result.ok ? styles.pass : styles.fail}>
            {result.gap ? "○" : result.ok ? "✓" : "✗"} {result.name}
          </Text>
          {result.detail ? <Text style={styles.detail}>{result.detail}</Text> : null}
        </View>
      ))}
      {running ? null : (
        <Button
          title="Run again"
          onPress={() => {
            setResults([]);
            setRunning(true);
            check();
          }}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  summary: { fontSize: 17, fontWeight: "600" },
  row: { gap: 2 },
  pass: { color: "#1a7f37", fontSize: 15 },
  fail: { color: "#cf222e", fontSize: 15 },
  gap: { color: "#9a6700", fontSize: 15 },
  detail: { color: "#888", fontSize: 13 },
});
