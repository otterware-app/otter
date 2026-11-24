import {
  runDelivery,
  runMeta,
  runStatusLabel,
  runWhen,
  useRunTranscript,
  useTaskRuns,
} from "@otter/client/agents/agent-scheduled";
import { readableError } from "@otter/client/errors";
import type { AgentScheduledTasks, ScheduledTask, TaskRun } from "@otter/contracts/scheduled";
import { Button } from "@otter/ui-native/components/button";
import { Icon } from "@otter/ui-native/components/icon";
import { Markdown } from "@otter/ui-native/components/markdown";
import { SettingsCell, SettingsSection } from "@otter/ui-native/components/settings";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { useState } from "react";
import { LayoutAnimation, Pressable, View } from "react-native";

/** A task's past runs, each opening on what it wrote and where that went. */
export function RunHistory({
  task,
  agent,
  now,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  now: number;
}) {
  const runs = useTaskRuns(task);
  const [open, setOpen] = useState<string | null>(null);
  if (runs.isLoading) return null;
  if (runs.isError)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
        <Text size="sm" color="mutedForeground" style={{ flex: 1 }}>
          {readableError(runs.error)}
        </Text>
        <Button title="Retry" variant="ghost" size="sm" onPress={() => void runs.refetch()} />
      </View>
    );
  if (!runs.data?.length) return null;
  return (
    <SettingsSection title="History">
      {runs.data.map((run) => (
        <View key={run.id}>
          <RunRow
            run={run}
            now={now}
            open={open === run.id}
            onToggle={() => {
              haptics.tap();
              LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeOut", "opacity"));
              setOpen(open === run.id ? null : run.id);
            }}
          />
          {open === run.id ? <RunDetail task={task} agent={agent} run={run} /> : null}
        </View>
      ))}
    </SettingsSection>
  );
}

function RunRow({
  run,
  now,
  open,
  onToggle,
}: {
  run: TaskRun;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const when = runWhen(run, now);
  const meta = runMeta(run);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={[when, runStatusLabel(run), meta].filter(Boolean).join(", ")}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
    >
      <SettingsCell>
        <View style={{ width: 24, alignItems: "center" }}>
          <Icon
            name={
              run.status === "ok"
                ? "checkmark.circle"
                : run.status === "skipped"
                  ? "minus.circle"
                  : "exclamationmark.circle"
            }
            size={17}
            color={
              run.status === "ok"
                ? "successForeground"
                : run.status === "skipped"
                  ? "mutedForeground"
                  : "error"
            }
          />
        </View>
        <View style={{ flex: 1, gap: 1, paddingVertical: 8 }}>
          <Text size="md">{when}</Text>
          {meta ? (
            <Text size="body" color="mutedForeground">
              {meta}
            </Text>
          ) : null}
        </View>
        <Icon
          name={open ? "chevron.up" : "chevron.down"}
          size={11}
          weight="semibold"
          color="faintForeground"
        />
      </SettingsCell>
    </Pressable>
  );
}

function RunDetail({
  task,
  agent,
  run,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks;
  run: TaskRun;
}) {
  const { transcript, text } = useRunTranscript(task, run);
  const delivery = runDelivery(run, agent);
  const said = text || run.summary;
  return (
    <View style={{ gap: 10, paddingHorizontal: 16, paddingBottom: 14 }}>
      {run.error ? (
        <Text size="sm" color="error" selectable>
          {run.error}
        </Text>
      ) : null}
      {transcript.isLoading ? (
        <View style={{ alignItems: "flex-start" }}>
          <Spinner size="mini" />
        </View>
      ) : transcript.isError ? (
        <Text size="sm" color="mutedForeground">
          Couldn't load what it wrote: {readableError(transcript.error)}
        </Text>
      ) : said ? (
        <Markdown markdown={said} />
      ) : run.error ? null : (
        <Text size="sm" color="mutedForeground">
          It had nothing to say.
        </Text>
      )}
      {delivery ? (
        <Text
          size="body"
          color={delivery.tone === "warning" ? "warningForeground" : "mutedForeground"}
        >
          {delivery.text}
        </Text>
      ) : null}
    </View>
  );
}
