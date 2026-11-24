import { Host, Menu, Picker, RNHostView, Text as SwiftText } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { useNow } from "@otter/client/agents/chat-shelves";
import {
  NO_FILTER,
  TASK_STATUSES,
  canCreateTasks,
  isFiltering,
  keyOf,
  matches,
  scheduledEmpty,
  taskAgents,
  taskSections,
  useAgentName,
  useScheduledTasks,
  type TaskFilter,
} from "@otter/client/agents/agent-scheduled";
import { readableError } from "@otter/client/errors";
import type { AgentScheduledTasks, ScheduledTask } from "@otter/contracts/scheduled";
import { Button, IconButton } from "@otter/ui-native/components/button";
import { Chip } from "@otter/ui-native/components/chip";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Icon } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { Stack, router } from "expo-router";
import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useBottomBarInset } from "../frame/tab-root.tsx";
import { TaskRow } from "./task-row.tsx";

/** What the agents do on their own, on a schedule (ScheduledScreen.swift): what needs you, what's coming up, what's paused. */
export function ScheduledScreen() {
  const query = useScheduledTasks(true);
  const agents = query.data ?? [];
  const tasks = agents.flatMap((a) => a.tasks);
  const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
  const shown = tasks.filter((t) => matches(t, filter));
  const { attention, active, paused } = taskSections(shown);
  const empty = scheduledEmpty(query, agents, shown);
  const now = useNow(30_000);
  const inset = useBottomBarInset();
  const [refreshing, setRefreshing] = useState(false);
  const agentOf = (task: ScheduledTask) => agents.find((a) => a.provider === task.provider);

  const refresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  const section = (title: string, list: ScheduledTask[]) =>
    list.length > 0 ? (
      <View style={{ gap: 8 }}>
        <Text
          size="sm"
          weight="medium"
          color="mutedForeground"
          accessibilityRole="header"
          style={{ paddingHorizontal: 26 }}
        >
          {title}
        </Text>
        {list.map((task) => (
          <TaskRow key={keyOf(task)} task={task} agent={agentOf(task)} now={now} />
        ))}
      </View>
    ) : null;

  return (
    <>
      <Stack.Screen options={{ title: "Scheduled" }} />
      {canCreateTasks(agents) ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel="New task"
            onPress={() => router.push("/scheduled/new")}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: inset }}
        scrollIndicatorInsets={{ bottom: inset }}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24, gap: 18, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {tasks.length > 0 ? <Filters tasks={tasks} value={filter} onChange={setFilter} /> : null}
        {agents
          .filter((a) => a.error || a.readOnly)
          .map((a) => (
            <AgentProblem
              key={a.provider}
              agent={a}
              onRetry={a.error ? () => void query.refetch() : undefined}
            />
          ))}
        {empty ? (
          <Empty
            kind={empty}
            error={query.error}
            creatable={canCreateTasks(agents)}
            onRetry={() => void query.refetch()}
            onShowAll={() => setFilter(NO_FILTER)}
          />
        ) : (
          <>
            {section("Needs attention", attention)}
            {section("Active", active)}
            {section("Paused", paused)}
          </>
        )}
      </ScrollView>
    </>
  );
}

/** The agent and status filters: chips that open the system's menu, and × to show all. */
function Filters({
  tasks,
  value,
  onChange,
}: {
  tasks: ScheduledTask[];
  value: TaskFilter;
  onChange: (filter: TaskFilter) => void;
}) {
  const agentName = useAgentName();
  const agents = taskAgents(tasks);
  const chosen = agents.find(([key]) => key === value.agent)?.[1].task;
  const status = TASK_STATUSES.find((s) => s.value === value.status)!;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ height: 44, paddingHorizontal: 20, gap: 8, alignItems: "center" }}
    >
      <FilterMenu
        label="Agent"
        chip={
          <Chip
            variant="glass"
            text={chosen ? agentName(chosen.provider, chosen.agent) : "All agents"}
            selected={Boolean(chosen)}
            leading={
              chosen ? (
                <AgentAvatar agent={chosen.provider} gatewayAgent={chosen.agent} size={14} />
              ) : undefined
            }
          />
        }
        value={value.agent ?? ""}
        options={[
          { value: "", label: "All agents" },
          ...agents.map(([key, { task, count }]) => ({
            value: key,
            label: `${agentName(task.provider, task.agent)} (${count})`,
          })),
        ]}
        onChange={(agent) => onChange({ ...value, agent: agent || null })}
      />
      <FilterMenu
        label="Status"
        chip={<Chip variant="glass" text={status.label} selected={value.status !== "all"} />}
        value={value.status}
        options={TASK_STATUSES}
        onChange={(next) => onChange({ ...value, status: next as TaskFilter["status"] })}
      />
      {isFiltering(value) ? (
        <IconButton
          icon="xmark.circle.fill"
          label="Show all"
          variant="ghost-muted"
          style={{ alignSelf: "center" }}
          onPress={() => onChange(NO_FILTER)}
        />
      ) : null}
    </ScrollView>
  );
}

/** A chip that opens a menu of choices, the chosen one checked (SwiftUI's `Menu { Picker }`). */
function FilterMenu({
  label,
  chip,
  value,
  options,
  onChange,
}: {
  label: string;
  chip: ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Host matchContents>
      <Menu
        label={
          <RNHostView matchContents>
            <View pointerEvents="none">{chip}</View>
          </RNHostView>
        }
      >
        <Picker
          label={label}
          selection={value}
          onSelectionChange={(next: string) => onChange(next)}
          modifiers={[pickerStyle("inline")]}
        >
          {options.map((o) => (
            <SwiftText key={o.value} modifiers={[tag(o.value)]}>
              {o.label}
            </SwiftText>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
}

function AgentProblem({ agent, onRetry }: { agent: AgentScheduledTasks; onRetry?: () => void }) {
  const theme = useTheme();
  const agentName = useAgentName();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 14,
        marginHorizontal: 18,
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: theme.colors.card,
      }}
    >
      <Icon
        name={agent.error ? "exclamationmark.triangle" : "lock"}
        size={15}
        color={agent.error ? "warningForeground" : "mutedForeground"}
      />
      <Text size="sm" style={{ flex: 1 }}>
        {agentName(agent.provider)}: {agent.error ?? agent.readOnly}
      </Text>
      {onRetry ? <Button title="Retry" variant="ghost" size="sm" onPress={onRetry} /> : null}
    </View>
  );
}

function Empty({
  kind,
  error,
  creatable,
  onRetry,
  onShowAll,
}: {
  kind: NonNullable<ReturnType<typeof scheduledEmpty>>;
  error: unknown;
  creatable: boolean;
  onRetry: () => void;
  onShowAll: () => void;
}) {
  const body = (() => {
    switch (kind) {
      case "loading":
        return <Spinner />;
      case "error":
        return (
          <EmptyState
            title="Couldn't read the tasks"
            description={readableError(error)}
            actions={<Button title="Retry" variant="secondary" onPress={onRetry} />}
          />
        );
      case "no-agents":
        return (
          <EmptyState
            title="No agent here runs tasks on a schedule"
            description="Add OpenClaw, Hermes or varys in Settings › Agents, and what they run on their own shows up here."
            actions={
              <Button
                title="Open Settings"
                variant="primary"
                size="lg"
                onPress={() => router.navigate("/settings/agents")}
              />
            }
          />
        );
      case "nothing":
        return (
          <EmptyState
            title="Nothing scheduled yet"
            description="Ask an agent to do something on a schedule, or make a task here."
            actions={
              creatable ? (
                <Button
                  title="New task"
                  icon="plus"
                  variant="secondary"
                  onPress={() => router.push("/scheduled/new")}
                />
              ) : undefined
            }
          />
        );
      case "no-match":
        return (
          <EmptyState
            title="No tasks match"
            actions={<Button title="Show all" variant="ghost-muted" onPress={onShowAll} />}
          />
        );
    }
  })();
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 60 }}>
      {body}
    </View>
  );
}
