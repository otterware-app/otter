import { shortAgo, useNow } from "@otter/client/agents/chat-shelves";
import { useChats } from "@otter/client/agents/chat-store";
import {
  deleteTask,
  deliveryText,
  enableTask,
  keyOf,
  managedNote,
  modelName,
  runTaskNow,
  taskCallout,
  taskEditable,
  taskNext,
  taskResults,
  useAgentName,
  useScheduledTasks,
  useTaskAction,
  useTaskModels,
} from "@otter/client/agents/agent-scheduled";
import { scheduleText } from "@otter/client/agents/scheduled-text";
import type { AgentScheduledTasks, ScheduledTask } from "@otter/contracts/scheduled";
import { Button } from "@otter/ui-native/components/button";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import {
  SettingsButton,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme, type ColorToken } from "@otter/ui-native/theme";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { openChat } from "../frame/navigation.ts";
import { RunHistory } from "./run-history.tsx";
import { confirmDelete } from "./task-row.tsx";

/** One scheduled task (TaskScreen.swift): when it runs next, what it does, and what its past runs wrote. */
export function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useScheduledTasks(true);
  const agents = query.data ?? [];
  const task = agents.flatMap((a) => a.tasks).find((t) => keyOf(t) === id);
  const agent = task && agents.find((a) => a.provider === task.provider);
  if (task && agent) return <TaskPage task={task} agent={agent} />;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
      <Stack.Screen options={{ title: "" }} />
      {query.isLoading ? (
        <Spinner />
      ) : (
        <>
          <Text size="xl" weight="semibold">
            This task is gone
          </Text>
          <Button title="All scheduled tasks" variant="ghost-muted" onPress={() => router.back()} />
        </>
      )}
    </View>
  );
}

function TaskPage({ task, agent }: { task: ScheduledTask; agent: AgentScheduledTasks }) {
  const theme = useTheme();
  const now = useNow(30_000);
  const agentName = useAgentName();
  const action = useTaskAction();
  const conversations = useChats((s) => s.conversations);
  const results = taskResults(conversations, task);
  const models = useTaskModels(task.provider, task.agent ?? "", Boolean(task.model));
  const [whole, setWhole] = useState(false);
  const locked = Boolean(agent.readOnly);
  const name = agentName(task.provider, task.agent);
  const next = taskNext(task, now) ?? (task.enabled ? null : "Paused");
  const callout = taskCallout(task, now);
  const text = task.prompt ?? task.runs ?? task.description ?? `It keeps ${name} going.`;
  const long = text.length > 360 || text.split("\n").length > 8;

  return (
    <SettingsPage>
      <Stack.Screen options={{ title: "" }} />
      <View style={{ gap: 6, paddingHorizontal: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <AgentAvatar agent={task.provider} gatewayAgent={task.agent} size={26} />
          <Text
            size="2xl"
            weight="semibold"
            accessibilityRole="header"
            style={{ flex: 1, letterSpacing: -0.3 }}
          >
            {task.name}
          </Text>
        </View>
        {next ? (
          <Text size="md" color={task.running ? "infoForeground" : "mutedForeground"}>
            {next}
          </Text>
        ) : null}
        {task.description && task.prompt ? (
          <Text size="md" color="mutedForeground">
            {task.description}
          </Text>
        ) : null}
      </View>

      {task.managedBy ? (
        <Note icon="lock" text={managedNote(task.managedBy)} />
      ) : agent.readOnly ? (
        <Note icon="lock" text={agent.readOnly} />
      ) : task.schedule.kind === "other" ? (
        <Note
          icon="lock"
          text={`Otter can't change this kind of schedule: change it in ${agentName(task.provider)}.`}
        />
      ) : null}
      {callout ? (
        <Note
          icon={task.autoPaused ? "pause.circle" : "exclamationmark.circle"}
          text={callout}
          tone={task.autoPaused ? "warningForeground" : "error"}
        />
      ) : null}
      {task.deliveryProblem ? (
        <Note
          icon="exclamationmark.triangle"
          text={task.deliveryProblem}
          tone="warningForeground"
        />
      ) : null}

      <SettingsSection>
        <SettingsSwitchRow
          title={task.enabled ? "Active" : "Paused"}
          value={task.enabled}
          disabled={locked}
          onValueChange={(on) => action.mutate(enableTask(task, on))}
        />
        <SettingsButton
          title={task.running ? "Running…" : "Run now"}
          disabled={task.running || locked}
          onPress={() => action.mutate(runTaskNow(task))}
        />
        {taskEditable(task, agent) ? (
          <SettingsButton
            title="Edit"
            onPress={() =>
              router.push({ pathname: "/scheduled/[id]/edit", params: { id: keyOf(task) } })
            }
          />
        ) : null}
        {!task.managedBy && !locked ? (
          <SettingsButton
            title="Delete…"
            destructive
            onPress={() =>
              confirmDelete(task, async () => {
                await action.mutateAsync(deleteTask(task));
                router.back();
              })
            }
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={task.prompt ? "Instructions" : task.runs ? "What it runs" : "What it does"}
      >
        <View style={{ padding: 16, gap: 8 }}>
          <Text
            size="md"
            selectable
            numberOfLines={whole ? undefined : 8}
            style={task.runs && !task.prompt ? { fontFamily: theme.fonts.mono } : undefined}
          >
            {text}
          </Text>
          {long && !whole ? (
            <Button title="Show all" variant="link" size="sm" onPress={() => setWhole(true)} />
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection>
        <Detail
          title="Repeats"
          value={
            scheduleText(task.schedule) +
            (task.conditional ? "\nOnly when its own check says so" : "")
          }
        />
        <Detail title="Agent" value={name} />
        {task.model ? <Detail title="Model" value={modelName(models.data, task.model)} /> : null}
        <Detail title="Results" value={deliveryText(task.delivery)} />
        {task.failureAlerts ? (
          <Detail title="Failures reported to" value={task.failureAlerts} />
        ) : null}
      </SettingsSection>

      {results.length > 0 ? (
        <SettingsSection title="Results in Otter">
          {results.map((chat) => (
            <SettingsRow
              key={chat.id}
              title={chat.title || "New chat"}
              icon="text.bubble"
              value={shortAgo(chat.updatedAt, now)}
              onPress={() => openChat(chat.id)}
            />
          ))}
        </SettingsSection>
      ) : null}

      {agent.can.history ? (
        <RunHistory task={task} agent={agent} now={now} />
      ) : (
        <Note text={`${agentName(task.provider)} doesn't keep a history of runs Otter can show.`} />
      )}
    </SettingsPage>
  );
}

function Note({ icon, text, tone }: { icon?: IconName; text: string; tone?: ColorToken }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 8 }}>
      {icon ? (
        <Icon
          name={icon}
          size={14}
          weight="medium"
          color={tone ?? "mutedForeground"}
          style={{ marginTop: 2 }}
        />
      ) : null}
      <Text size="sm" color={tone ?? "mutedForeground"} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function Detail({ title, value }: { title: string; value: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${title}, ${value}`}
      style={{
        flexDirection: "row",
        alignItems: "baseline",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <Text size="md" color="mutedForeground">
        {title}
      </Text>
      <Text size="md" style={{ flex: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}
