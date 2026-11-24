import {
  deleteTask,
  enableTask,
  keyOf,
  runTaskNow,
  taskProblem,
  taskWhen,
  useAgentName,
  useTaskAction,
} from "@otter/client/agents/agent-scheduled";
import { scheduleText } from "@otter/client/agents/scheduled-text";
import type { AgentScheduledTasks, ScheduledTask } from "@otter/contracts/scheduled";
import { Icon } from "@otter/ui-native/components/icon";
import { SwipeRow } from "@otter/ui-native/components/swipe-row";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { useTheme, type ColorToken } from "@otter/ui-native/theme";
import { Link, router } from "expo-router";
import { ActionSheetIOS, Pressable, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { HeldRow } from "../frame/held-row.tsx";

/** Asks before deleting a task, as the Swift app's confirmation dialog. */
export function confirmDelete(task: ScheduledTask, onDelete: () => void) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `Delete “${task.name}”?`,
      message:
        "It stops running, and its agent forgets it. What it already sent stays where it went.",
      options: ["Delete", "Cancel"],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index === 0) onDelete();
    },
  );
}

const WHEN_COLOR: Record<string, ColorToken> = {
  running: "infoForeground",
  "auto-paused": "warningForeground",
  failed: "warningForeground",
};

/** A task's card (ScheduledScreen.swift's `card`): who runs it, what it asks, when; swipe or touch and hold to run, pause or delete it. */
export function TaskRow({
  task,
  agent,
  now,
}: {
  task: ScheduledTask;
  agent: AgentScheduledTasks | undefined;
  now: number;
}) {
  const theme = useTheme();
  const agentName = useAgentName();
  const action = useTaskAction();
  const when = taskWhen(task, now);
  const problem = taskProblem(task);
  const preview = task.prompt ?? task.description ?? task.runs;
  const line = `${agentName(task.provider, task.agent)} · ${scheduleText(task.schedule)}`;
  const announcesState =
    when?.kind === "running" || when?.kind === "paused" || when?.kind === "auto-paused";
  const locked = Boolean(agent?.readOnly);
  const deletable = !locked && !task.managedBy;
  const run = () => action.mutate(runTaskNow(task));
  const toggle = () => {
    haptics.tap();
    action.mutate(enableTask(task, !task.enabled));
  };
  const remove = () => confirmDelete(task, () => action.mutate(deleteTask(task)));
  const href = { pathname: "/scheduled/[id]" as const, params: { id: keyOf(task) } };

  return (
    <HeldRow
      open={() => router.push(href)}
      value={announcesState ? undefined : task.enabled ? "Active" : "Paused"}
      actions={[
        ...(locked
          ? []
          : [
              ...(task.running ? [] : [{ name: "Run now", run }]),
              { name: task.enabled ? "Pause" : "Resume", run: toggle },
            ]),
        ...(deletable ? [{ name: "Delete…", run: remove }] : []),
      ]}
    >
      <SwipeRow
        leading={
          locked
            ? undefined
            : {
                title: task.enabled ? "Pause" : "Resume",
                icon: task.enabled ? "pause.fill" : "play.fill",
                tint: theme.colors.primary,
                onPerform: toggle,
              }
        }
        trailing={
          deletable
            ? { title: "Delete", icon: "trash", tint: theme.colors.error, onPerform: remove }
            : undefined
        }
      >
        <View style={{ paddingHorizontal: 18 }}>
          <Link href={href} asChild>
            <Link.Trigger>
              <Pressable accessibilityRole="button">
                <View
                  style={{
                    gap: 6,
                    paddingHorizontal: 16,
                    paddingVertical: 13,
                    borderRadius: 20,
                    borderCurve: "continuous",
                    backgroundColor: theme.colors.card,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <AgentAvatar agent={task.provider} gatewayAgent={task.agent} size={18} />
                    <Text
                      size="base"
                      weight="medium"
                      color={task.enabled ? "foreground" : "mutedForeground"}
                      numberOfLines={1}
                      style={{ flex: 1 }}
                    >
                      {task.name}
                    </Text>
                    {problem ? (
                      <View accessible accessibilityLabel="Needs attention">
                        <Icon
                          name="exclamationmark.circle"
                          size={14}
                          weight="semibold"
                          color="warningForeground"
                        />
                      </View>
                    ) : task.managedBy ? (
                      <Icon name="lock" size={12} color="faintForeground" />
                    ) : null}
                  </View>
                  {preview ? (
                    <Text size="sm" color="mutedForeground" numberOfLines={2}>
                      {preview}
                    </Text>
                  ) : null}
                  <Text size="body" color="faintForeground" numberOfLines={1}>
                    {line}
                    {when ? (
                      <Text size="body" color={WHEN_COLOR[when.kind] ?? "faintForeground"}>
                        {` · ${when.text}`}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              </Pressable>
            </Link.Trigger>
            <Link.Preview style={{ backgroundColor: theme.colors.canvas }} />
            <Link.Menu>
              {locked ? null : (
                <Link.MenuAction icon="play" disabled={task.running} onPress={run}>
                  Run now
                </Link.MenuAction>
              )}
              {locked ? null : (
                <Link.MenuAction icon={task.enabled ? "pause" : "play.circle"} onPress={toggle}>
                  {task.enabled ? "Pause" : "Resume"}
                </Link.MenuAction>
              )}
              {deletable ? (
                <Link.MenuAction icon="trash" destructive onPress={remove}>
                  Delete…
                </Link.MenuAction>
              ) : null}
            </Link.Menu>
          </Link>
        </View>
      </SwipeRow>
    </HeldRow>
  );
}
