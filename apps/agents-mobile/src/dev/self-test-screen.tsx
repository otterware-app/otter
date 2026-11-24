import {
  roundTripChecks,
  runChecks,
  runtimeChecks,
  type CheckResult,
} from "@otter/mobile/self-test";
import { Button } from "@otter/ui-native/components/button";
import { Text } from "@otter/ui-native/components/text";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { FAKE } from "../core.ts";

/** What core needs of Hermes and the phone, and over the fake a round trip through the client. */
export function SelfTestScreen() {
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Text weight="semibold" testID="self-test-summary">
        {running
          ? `Running… ${results.length} done`
          : failed
            ? `${failed} of ${results.length - gaps} failed${known}`
            : `All ${results.length - gaps} passed${known}`}
      </Text>
      {FAKE ? null : (
        <Text size="body" color="mutedForeground">
          The round trip through core runs over the fake: pnpm dev:mobile:agents:fake.
        </Text>
      )}
      {results.map((result) => (
        <View key={result.name} style={{ gap: 2 }}>
          <Text
            size="md"
            color={result.gap ? "warningForeground" : result.ok ? "successForeground" : "error"}
          >
            {result.gap ? "○" : result.ok ? "✓" : "✗"} {result.name}
          </Text>
          {result.detail ? (
            <Text size="body" color="mutedForeground">
              {result.detail}
            </Text>
          ) : null}
        </View>
      ))}
      {running ? null : (
        <Button
          title="Run again"
          variant="secondary"
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
